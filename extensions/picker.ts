/**
 * TUI inline picker — live iTerm2 theme picker.
 *
 * Architecture:
 * - handleInput only updates state (selectedTheme) and calls requestRender.
 *   It NEVER calls setTheme, buildThemeInstance, or applyThemeToIterm directly.
 * - A trailing-only debounce reads the latest selectedTheme and applies preview.
 *   Pi theme update is synchronous inside the debounce. iTerm2 apply is
 *   fire-and-forget — never awaited, never blocks the debounce callback.
 * - iTerm2 connection is opened once at picker start, closed on confirm/cancel.
 * - Disk write and Pi theme persist happen only on confirm.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem, matchesKey } from "@mariozechner/pi-tui";
import { debounce } from "perfect-debounce";
import { EMBEDDED_THEMES } from "./themes.js";
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

	// Build Pi restore instance from current Pi theme colors if possible.
	// ctx.ui.theme is a Proxy — capture colors from the embedded theme matching current Pi theme name.
	const currentPiThemeName = ctx.ui.theme.name ?? "";
	const matchingEntry = entries.find((e) => {
		const slug = slugifyThemeName(e.name);
		return currentPiThemeName.includes(slug);
	});
	const originalPiInstance = matchingEntry
		? buildThemeInstance(matchingEntry.colors, `term-restore-${Date.now()}`, getThemeParams(slugifyThemeName(matchingEntry.name)), ctx)
		: null;

	// Track the "current" theme name for display tagging
	const currentThemeName = matchingEntry?.name ?? null;

	let filterMode: FilterMode = "all";
	let searchText = "";
	let selectedTheme = currentThemeName && entryByName.has(currentThemeName)
		? currentThemeName
		: entries[0]!.name;
	let closed = false;
	let lastAppliedTheme: string | null = null;

	// Trailing-only debounce — NEVER runs during handleInput.
	// Pi setTheme is synchronous. iTerm2 apply is fire-and-forget.
	const applyPreview = debounce(() => {
		if (closed || selectedTheme === lastAppliedTheme) return;
		const entry = entryByName.get(selectedTheme);
		if (!entry) return;
		lastAppliedTheme = selectedTheme;

		const slug = slugifyThemeName(entry.name);
		const instance = buildThemeInstance(entry.colors, `term-preview-${slug}-${Date.now()}`, getThemeParams(slug), ctx);
		ctx.ui.setTheme(instance);

		// Fire-and-forget — never block the debounce callback
		if (sessionId) {
			applyThemeToIterm(entry, sessionId).catch(() => {});
		}
	}, getPreviewDebounceMs());

	const closeWithConfirm = (themeName: string, done: (value: string | null) => void): void => {
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

		// Persist Pi theme — synchronous
		writeAndSetPiTheme(ctx, entry.colors, themeName, getThemeParams(slugifyThemeName(themeName)));

		// Fire-and-forget iTerm2 confirm + disconnect
		if (sessionId) {
			applyThemeToIterm(entry, sessionId).catch(() => {}).finally(() => disconnectIterm());
		} else {
			disconnectIterm();
		}

		done(themeName);
	};

	const closeWithCancel = (done: (value: string | null) => void): void => {
		if (closed) return;
		closed = true;
		applyPreview.cancel();

		// Restore Pi theme — synchronous
		if (originalPiInstance) ctx.ui.setTheme(originalPiInstance);

		// Fire-and-forget iTerm2 restore + disconnect
		if (originalSnapshot) {
			restoreItermSnapshot(originalSnapshot).catch(() => {}).finally(() => disconnectIterm());
		} else {
			disconnectIterm();
		}

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

		const buildSelectItems = (visibleEntries: ThemeEntry[]): SelectItem[] => {
			return visibleEntries.map((entry) => {
				const tags: string[] = [];
				if (entry.name === currentThemeName) tags.push("current");
				tags.push(entry.isDark ? "dark" : "light");
				return {
					value: entry.name,
					label: entry.name,
					description: tags.join(" \u00B7 "),
				};
			});
		};

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
				theme.fg("dim", `${filterMode} \u00B7 ${searchText || "\u2014"}`),
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
			selectList.onSelect = (item) => closeWithConfirm(item.value, done);
			selectList.onCancel = () => closeWithCancel(done);

			container.addChild(selectList);
			container.addChild(new Text(
				theme.fg("dim", " type to search \u00B7 backspace delete \u00B7 tab all/dark/light \u00B7 \u2191\u2193 navigate \u00B7 enter apply \u00B7 esc cancel"),
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
				// SelectList handles arrow keys, enter, esc.
				// onSelectionChange updates selectedTheme + schedules debounced preview.
				selectList?.handleInput(data);
				tui.requestRender();
			},
		};
	});

	return selected ?? null;
}
