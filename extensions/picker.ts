/**
 * TUI inline picker — live iTerm2 theme picker.
 *
 * Architecture:
 * - handleInput only updates state (selectedTheme) and calls requestRender.
 *   It NEVER calls setTheme, buildThemeInstance, or applyThemeToIterm directly.
 * - A trailing-only debounce reads the latest selectedTheme and applies preview.
 *   Completely decoupled from input.
 * - iTerm2 connection is opened once at picker start, closed on confirm/cancel.
 * - Disk write and Pi theme persist happen only on confirm.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem, matchesKey } from "@mariozechner/pi-tui";
import { debounce } from "perfect-debounce";
import { EMBEDDED_THEMES, getEmbeddedThemeByName } from "./themes.js";
import {
	ensureItermConnection,
	disconnectIterm,
	getActiveItermSessionId,
	captureItermSnapshot,
	applyThemeToIterm,
	restoreItermSnapshot,
	type ItermThemeSnapshot,
} from "./iterm2.js";
import { writeAndSetPiTheme, buildThemeInstance, slugifyThemeName } from "./pi-theme.js";
import { getThemeParams, getPreviewDebounceMs } from "./settings.js";
import type { ThemeEntry, FilterMode, CommandContext } from "./types.js";

function isPrintableInput(data: string): boolean {
	return data.length === 1 && data >= " " && data !== "\x7f";
}

function nextFilterMode(mode: FilterMode): FilterMode {
	if (mode === "all") return "dark";
	if (mode === "dark") return "light";
	return "all";
}

export async function showThemePicker(_pi: ExtensionAPI, ctx: CommandContext): Promise<string | null> {
	const entries = EMBEDDED_THEMES;
	if (entries.length === 0) {
		ctx.ui.notify("No themes available", "warning");
		return null;
	}

	const entryByName = new Map(entries.map((e) => [e.name, e]));

	// Open iTerm2 connection once up-front — ~300ms cost absorbed here, not during preview
	let sessionId: string | null = null;
	let originalSnapshot: ItermThemeSnapshot | null = null;
	try {
		await ensureItermConnection();
		sessionId = await getActiveItermSessionId();
		if (sessionId) originalSnapshot = await captureItermSnapshot(sessionId);
	} catch {
		// iTerm2 unavailable — Pi-only preview will still work
	}

	// Build Pi restore instance from current Pi theme colors if possible
	// ctx.ui.theme is a Proxy — capture colors from the first embedded theme matching current Pi theme name
	const currentPiThemeName = ctx.ui.theme.name ?? "";
	const matchingEntry = entries.find((e) => {
		const slug = slugifyThemeName(e.name);
		return currentPiThemeName.includes(slug);
	});
	const originalPiInstance = matchingEntry
		? buildThemeInstance(matchingEntry.colors, `term-restore-${Date.now()}`, getThemeParams(slugifyThemeName(matchingEntry.name)), ctx)
		: null;

	let filterMode: FilterMode = "all";
	let searchText = "";
	let selectedTheme = entries[0]!.name;
	let closed = false;
	let lastAppliedTheme: string | null = null;

	// Trailing-only debounce — NEVER runs during handleInput.
	// Uses Promise.all for both Pi and iTerm2 apply (~260ms each, overlap possible).
	const applyPreview = debounce(async () => {
		if (closed || selectedTheme === lastAppliedTheme) return;
		const entry = entryByName.get(selectedTheme);
		if (!entry) return;
		lastAppliedTheme = selectedTheme;

		const slug = slugifyThemeName(entry.name);
		const instance = buildThemeInstance(entry.colors, `term-preview-${slug}-${Date.now()}`, getThemeParams(slug), ctx);
		ctx.ui.setTheme(instance);

		if (sessionId) {
			try {
				await applyThemeToIterm(entry, sessionId);
			} catch {
				// Degrade gracefully — Pi preview still works
			}
		}
	}, getPreviewDebounceMs());

	const closeWithConfirm = async (themeName: string, done: (value: string | null) => void): Promise<void> => {
		if (closed) return;
		closed = true;
		applyPreview.cancel();

		const entry = entryByName.get(themeName);
		if (!entry) {
			ctx.ui.notify(`Theme not found: ${themeName}`, "error");
			disconnectIterm();
			done(null);
			return;
		}

		// Persist Pi theme from embedded colors
		writeAndSetPiTheme(ctx, entry.colors, themeName, getThemeParams(slugifyThemeName(themeName)));

		// Ensure iTerm2 reflects confirmed theme (may already be applied from preview)
		if (sessionId) {
			try {
				await applyThemeToIterm(entry, sessionId);
			} catch {
				// Non-fatal — Pi theme is already written
			}
		}

		disconnectIterm();
		done(themeName);
	};

	const closeWithCancel = async (done: (value: string | null) => void): Promise<void> => {
		if (closed) return;
		closed = true;
		applyPreview.cancel();

		// Restore Pi theme
		if (originalPiInstance) ctx.ui.setTheme(originalPiInstance);

		// Restore iTerm2 terminal colors
		if (originalSnapshot) {
			try {
				await restoreItermSnapshot(originalSnapshot);
			} catch {
				// Best-effort restore
			}
		}

		disconnectIterm();
		done(null);
	};

	const selected = await ctx.ui.custom<string | null>((tui, _factoryTheme, _keybindings, done) => {
		const t = () => ctx.ui.theme;
		const container = new Container();
		let selectList: SelectList | null = null;

		const getVisibleEntries = (): ThemeEntry[] => {
			const byMode = entries.filter((entry) => {
				if (filterMode === "all") return true;
				if (filterMode === "dark") return entry.isDark;
				return !entry.isDark;
			});
			if (!searchText) return byMode;
			const needle = searchText.toLowerCase();
			return byMode.filter((entry) => entry.name.toLowerCase().includes(needle));
		};

		const buildSelectItems = (visibleEntries: ThemeEntry[]): SelectItem[] =>
			visibleEntries.map((entry) => ({
				value: entry.name,
				label: entry.name,
				description: entry.isDark ? "dark" : "light",
			}));

		const rebuild = (): void => {
			const theme = t();
			const visibleEntries = getVisibleEntries();
			const items = buildSelectItems(visibleEntries);

			if (items.length > 0 && !items.some((item) => item.value === selectedTheme)) {
				selectedTheme = items[0]!.value;
			}

			container.clear();
			container.addChild(new DynamicBorder((s: string) => t().fg("accent", s)));
			container.addChild(new Text(
				theme.fg("accent", theme.bold(" Theme Picker")) +
				"  " +
				theme.fg("dim", `${filterMode} · ${searchText || "—"}`),
			));

			selectList = new SelectList(items, 14, {
				selectedPrefix: (text) => t().fg("accent", text),
				selectedText: (text) => t().fg("accent", text),
				description: (text) => t().fg("muted", text),
				scrollInfo: (text) => t().fg("dim", text),
				noMatch: (text) => t().fg("warning", text),
			});

			const selectedIndex = items.findIndex((item) => item.value === selectedTheme);
			if (selectedIndex >= 0) selectList.setSelectedIndex(selectedIndex);

			// onSelectionChange ONLY updates state — no heavy work
			selectList.onSelectionChange = (item) => {
				selectedTheme = item.value;
				applyPreview(); // debounced — won't run inline
			};
			selectList.onSelect = (item) => { void closeWithConfirm(item.value, done); };
			selectList.onCancel = () => { void closeWithCancel(done); };

			container.addChild(selectList);
			container.addChild(new Text(
				theme.fg("dim", " type to search · backspace delete · tab all/dark/light · ↑↓ navigate · enter apply · esc cancel"),
			));
			container.addChild(new DynamicBorder((s: string) => t().fg("accent", s)));
		};

		rebuild();
		applyPreview(); // initial preview

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.tab)) {
					filterMode = nextFilterMode(filterMode);
					rebuild();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.backspace)) {
					if (searchText.length > 0) {
						searchText = searchText.slice(0, -1);
						rebuild();
						tui.requestRender();
					}
					return;
				}
				if (isPrintableInput(data)) {
					searchText += data;
					rebuild();
					tui.requestRender();
					return;
				}
				// SelectList handles arrow keys, enter, esc
				selectList?.handleInput(data);
				tui.requestRender();
			},
		};
	});

	return selected ?? null;
}
