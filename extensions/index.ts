/**
 * pi-term
 *
 * Registers /theme command for live iTerm2 theme picking with debounced preview.
 * Registers /theme-settings command for configuring theme generation settings.
 */

import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Key, Markdown, type AutocompleteItem, type Component, type OverlayHandle, type SettingItem, SettingsList, Spacer, Text, Box, matchesKey } from "@mariozechner/pi-tui";
import { ensureSemanticHue, hexToRgb, mixColors } from "./colors.js";
import {
	slugifyThemeName,
	writeAndSetPiTheme,
	buildThemeInstance,
	resolvePaletteSourceColor,
} from "./pi-theme.js";
import { showThemePicker } from "./picker.js";
import {
	getSettings,
	updateSettings,
	updateThemeParamInMemory,
	persistSettings,
	getThemeParams,
	getPreviewDebounceMs,
	loadSettings,
	resetThemeParams,
	setOverrideEnabled,
	clearOverrideParam,
	getCurrentTheme,
	setCurrentTheme,
} from "./settings.js";
import { DEFAULT_THEME_PARAMS, type SessionContext, type ThemeParams } from "./types.js";
import { EMBEDDED_THEMES, getEmbeddedThemeByName } from "./themes.js";
import { initItermConnection, applyThemeToItermSync } from "./iterm2.js";
import { debounce } from "perfect-debounce";

const STATUS_KEY = "terminal-theme";

// Cached theme names for autocomplete — populated from embedded catalog
let cachedThemeNames: string[] = [];

function formatParamValue(value: number): string {
	if (Number.isInteger(value)) return value.toFixed(0);
	return value.toFixed(2);
}

function updateStatus(ctx: ExtensionContext, themeName?: string, params?: ThemeParams): void {
	if (!themeName) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const statusParts: string[] = [`theme:${themeName}`];
	if (params) {
		const summaryMap: Array<{ key: keyof ThemeParams; short: string }> = [
			{ key: "mutedWeight", short: "muted" },
			{ key: "dimWeight", short: "dim" },
			{ key: "borderWeight", short: "border" },
			{ key: "bgShift", short: "bg" },
			{ key: "selectedBgFactor", short: "selBg" },
			{ key: "userMsgBgFactor", short: "msgBg" },
			{ key: "toolPendingBgFactor", short: "pendBg" },
			{ key: "toolSuccessTint", short: "okTint" },
			{ key: "toolErrorTint", short: "errTint" },
			{ key: "customMsgTint", short: "custTint" },
			{ key: "linkContrastMin", short: "linkCR" },
		];
		const diffSummary = summaryMap
			.filter(({ key }) => params[key] !== DEFAULT_THEME_PARAMS[key])
			.map(({ key, short }) => `${short}:${formatParamValue(params[key] as number)}`)
			.join(" ");
		if (diffSummary) statusParts.push(diffSummary);
	}

	let text = statusParts.join(" · ");
	if (text.length > 60) text = `${text.slice(0, 57)}…`;
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", text));
}

function parseCommandThemeName(args: string): string {
	const trimmed = args.trim();
	if (
		(trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** Render a single truecolor block for a hex color. */
/** Color swatch using background color — doesn't interfere with fg accent on selection. */
function swatch(hex: string): string {
	const { r, g, b } = hexToRgb(hex);
	return `\x1b[48;2;${r};${g};${b}m  \x1b[49m`;
}

/** Generate a string[] of numeric values from min to max with given step, formatted to decimals. */
function numRange(min: number, max: number, step: number, decimals: number): string[] {
	const values: string[] = [];
	for (let v = min; v <= max + step / 2; v += step) {
		values.push(v.toFixed(decimals));
	}
	return values;
}

// --- Theme preview overlay ---

// Captured internal runner — provides getToolDefinition with extension overrides.
let _runner: { getToolDefinition: (name: string) => any } | null = null;
let _tecClass: any = null;

async function captureRunner(pi: ExtensionAPI): Promise<void> {
	try {
		const inspector = require("node:inspector");
		const session = new inspector.Session();
		session.connect();
		const post = (method: string, params: Record<string, unknown>): Promise<any> =>
			new Promise((resolve, reject) => session.post(method, params, (err: Error | null, res: unknown) => err ? reject(err) : resolve(res)));

		const key = `__termTheme_${Date.now()}`;
		(globalThis as any)[key] = pi.getAllTools;
		try {
			const fn1 = await post("Runtime.evaluate", { expression: `globalThis.${key}` });
			const int1 = await post("Runtime.getProperties", { objectId: fn1.result.objectId, ownProperties: false });
			const scopesId1 = int1.internalProperties.find((p: any) => p.name === "[[Scopes]]").value.objectId;
			const chain1 = await post("Runtime.getProperties", { objectId: scopesId1, ownProperties: true });
			const props1 = await post("Runtime.getProperties", { objectId: chain1.result[0].value.objectId, ownProperties: true });
			const runtimeId = props1.result.find((p: any) => p.name === "runtime").value.objectId;
			await post("Runtime.callFunctionOn", { objectId: runtimeId, functionDeclaration: `function() { globalThis.${key} = this.getAllTools; }` });
			const fn2 = await post("Runtime.evaluate", { expression: `globalThis.${key}` });
			const int2 = await post("Runtime.getProperties", { objectId: fn2.result.objectId, ownProperties: false });
			const scopesId2 = int2.internalProperties.find((p: any) => p.name === "[[Scopes]]").value.objectId;
			const chain2 = await post("Runtime.getProperties", { objectId: scopesId2, ownProperties: true });
			const props2 = await post("Runtime.getProperties", { objectId: chain2.result[0].value.objectId, ownProperties: true });
			const runnerId = props2.result.find((p: any) => p.name === "runner").value.objectId;
			await post("Runtime.callFunctionOn", { objectId: runnerId, functionDeclaration: `function() { globalThis.${key} = this; }` });
			_runner = (globalThis as any)[key];
		} finally {
			delete (globalThis as any)[key];
			session.disconnect();
		}
	} catch { /* runner capture failed — will fall back to built-in defs */ }

	try {
		const base = require.resolve("@mariozechner/pi-coding-agent").replace(/dist\/index\.js$/, "dist/");
		_tecClass = require(`${base}modes/interactive/components/tool-execution.js`).ToolExecutionComponent;
		// If runner capture failed, load built-in defs as fallback
		if (!_runner) {
			const defs = require(`${base}core/tools/index.js`).allToolDefinitions;
			_runner = { getToolDefinition: (name: string) => defs[name] };
		}
	} catch { /* ToolExecutionComponent not available */ }
}

/** Create a completed ToolExecutionComponent with mocked result — no actual execution. */
function createMockedTool(
	name: string,
	args: Record<string, unknown>,
	result: { content: { type: string; text: string }[]; details?: unknown; isError: boolean },
): Component | null {
	if (!_tecClass || !_runner) return null;
	const def = _runner.getToolDefinition(name);
	if (!def) return null;
	const mockUi = { requestRender: () => {} };
	const comp = new _tecClass(name, `preview-${name}-${Date.now()}`, args, { showImages: false }, def, mockUi, process.cwd());
	comp.setArgsComplete();
	comp.markExecutionStarted();
	comp.updateResult(result);
	return comp as Component;
}

/**
 * Non-capturing overlay that previews theme colors using Pi's actual renderers.
 * ToolExecutionComponent renders tool calls identically to real Pi output
 * (syntax highlighting, diff rendering, backgrounds, timing).
 * Markdown handles user/assistant/custom messages. Box handles selected highlight.
 */
/** Page definition for paginated preview. */
interface PreviewPage {
	title: string;
	build: (theme: any) => { container: Container; executions: { comp: any; name: string; args: Record<string, unknown> }[] };
}

function getPreviewPages(): PreviewPage[] {
	const sampleCode = [
		'import { verify } from "./crypto";',
		"",
		"export async function login(user: string, token: string) {",
		"  const valid = await verify(token);",
		'  if (!valid) throw new Error("invalid token");',
		'  return { user, role: "admin" };',
		"}",
	].join("\n");

	return [
		// Page 1: Messages — user msg, assistant text, custom msg, selected
		{
			title: "Messages",
			build: (theme) => {
				const c = new Container();
				c.addChild(new Spacer(1));
				c.addChild(new Markdown("Fix the auth bug in login.ts", 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("userMessageBg", text),
					color: (text: string) => theme.fg("userMessageText", text),
				}));
				c.addChild(new Spacer(1));
				c.addChild(new Markdown(
					"I'll fix the **authentication** bug.\n" +
					"Let me [read the file](src/auth.ts) first.",
					1, 0, getMarkdownTheme(),
				));
				c.addChild(new Spacer(1));
				c.addChild(new Markdown(
					"## Done\n" +
					"- Added `\"HS256\"` algorithm parameter\n" +
					"- All tests [passing](results.txt)\n\n" +
					"> **Note:** review before merging",
					1, 0, getMarkdownTheme(),
				));
				c.addChild(new Spacer(1));
				c.addChild(new Markdown("\u2139 Extension notice: theme synced", 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("customMessageBg", text),
					color: (text: string) => theme.fg("customMessageText", text),
				}));
				c.addChild(new Spacer(1));
				const selBox = new Box(1, 0, (text: string) => theme.bg("selectedBg", text));
				selBox.addChild(new Text("\u2192 Selected item highlight", 0, 0));
				c.addChild(selBox);
				return { container: c, executions: [] };
			},
		},
		// Page 2: Read tool
		{
			title: "Read",
			build: (_theme) => {
				const c = new Container();
				const comp = createMockedTool("read", { path: "src/auth.ts" }, {
					content: [{ type: "text", text: sampleCode }],
					details: { _type: "readFile", filePath: "src/auth.ts", content: sampleCode, offset: 1, lineCount: 7 },
					isError: false,
				});
				if (comp) c.addChild(comp);
				c.addChild(new Markdown(
					"**Syntax-highlighted** file content.\n" +
					"Background: `toolSuccessBg` \u00B7 Header: `toolTitle` \u00B7 Content: `toolOutput`\n\n" +
					"Syntax: `syntaxKeyword` `syntaxFunction` `syntaxString` `syntaxVariable`",
					1, 1, getMarkdownTheme(),
				));
				return { container: c, executions: [] };
			},
		},
		// Page 3: Edit tool
		{
			title: "Edit",
			build: (_theme) => {
				const c = new Container();
				const comp = createMockedTool("edit", {
					path: "src/auth.ts",
					edits: [{ oldText: "await verify(token)", newText: 'await verify(token, "HS256")' }],
				}, {
					content: [{ type: "text", text: "1 edit applied" }],
					details: { diff: "--- src/auth.ts\n+++ src/auth.ts\n@@ -3,4 +3,4 @@\n export async function login(user: string, token: string) {\n-  const valid = await verify(token);\n+  const valid = await verify(token, \"HS256\");\n   if (!valid) throw new Error(\"invalid token\");" },
					isError: false,
				});
				if (comp) c.addChild(comp);
				c.addChild(new Markdown(
					"**Inline diff** with colored changes.\n" +
					"Added: `toolDiffAdded` \u00B7 Removed: `toolDiffRemoved` \u00B7 Context: `toolDiffContext`\n\n" +
					"Background: `toolSuccessBg` on success, `toolErrorBg` on failure.",
					1, 1, getMarkdownTheme(),
				));
				return { container: c, executions: [] };
			},
		},
		// Page 4: Bash tool
		{
			title: "Bash",
			build: (_theme) => {
				const c = new Container();
				const comp = createMockedTool("bash", { command: "npm test" }, {
					content: [{ type: "text", text: "PASS src/auth.test.ts\n  \u2714 login validates token (3ms)\n  \u2714 login rejects invalid (1ms)\n\nTests: 2 passed, 2 total" }],
					details: { rawText: "PASS src/auth.test.ts\n  \u2714 login validates token (3ms)\n  \u2714 login rejects invalid (1ms)\n\nTests: 2 passed, 2 total", exitCode: 0 },
					isError: false,
				});
				if (comp) c.addChild(comp);
				c.addChild(new Markdown(
					"**Command** output with exit status and timing.\n" +
					"Success: `toolSuccessBg` \u00B7 Failure: `toolErrorBg`\n\n" +
					"Output: `toolOutput` \u00B7 Timing: `muted`",
					1, 1, getMarkdownTheme(),
				));
				return { container: c, executions: [] };
			},
		},
	];
}

class ThemePreview implements Component {
	private pages: PreviewPage[] = [];
	private pageIdx = 0;
	private pageContainer = new Container();
	private maxHeight = 0;
	private maxHeightDirty = true;
	private lastRenderWidth = 0;
	private _lastTheme: any = null;


	// biome-ignore lint: Theme proxy has typed keys but we use string-based lookups
	rebuild(t: () => any): void {
		const theme = t();
		this._lastTheme = theme;
		this.setBorderFn(
			(s: string) => theme.fg("borderMuted", s),
			(s: string) => theme.fg("accent", s),
		);
		if (this.pages.length === 0) this.pages = getPreviewPages();
		this.maxHeightDirty = true;
		const page = this.pages[this.pageIdx];
		if (!page) return;
		const { container, executions } = page.build(theme);
		this.pageContainer = container;

	}

	nextPage(): void { this.pageIdx = (this.pageIdx + 1) % this.pages.length; }
	prevPage(): void { this.pageIdx = (this.pageIdx - 1 + this.pages.length) % this.pages.length; }
	getPageLabel(): string {
		const p = this.pages[this.pageIdx];
		return p ? `${p.title} (${this.pageIdx + 1}/${this.pages.length})` : "";
	}

	invalidate(): void { this.pageContainer.invalidate(); }

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);

		// Recompute max height when width changes or pages were rebuilt.
		if (this.maxHeightDirty || this.lastRenderWidth !== inner) {
			this.lastRenderWidth = inner;
			this.maxHeight = 0;
			for (const p of this.pages) {
				// Use a throwaway build to measure — the real page is in pageContainer
				const { container } = p.build(this._lastTheme);
				const h = container.render(inner).length;
				if (h > this.maxHeight) this.maxHeight = h;
			}
			this.maxHeightDirty = false;
		}

		const content = this.pageContainer.render(inner);

		// Fixed height: pad to maxHeight so overlay doesn't jump between pages.
		const padded = [...content];
		while (padded.length < this.maxHeight) padded.push("");

		const b = (s: string) => this.borderFn?.(s) ?? s;
		const label = this.getPageLabel();
		const title = this.titleFn?.(` ${label} `) ?? ` ${label} `;
		const titleW = title.replace(/\x1b\[[^m]*m/g, "").length;
		const topFill = Math.max(0, inner - titleW);
		const top = b("\u256D") + title + b("\u2500".repeat(topFill)) + b("\u256E");
		const hint = this.hintFn?.(" n next \u00B7 N prev \u00B7 p hide ") ?? " n next \u00B7 N prev \u00B7 p hide ";
		const hintW = hint.replace(/\x1b\[[^m]*m/g, "").length;
		const botFill = Math.max(0, inner - hintW);
		const bot = b("\u2570") + hint + b("\u2500".repeat(botFill)) + b("\u256F");
		const wrap = (line: string): string => {
			const vis = line.replace(/\x1b\[[^m]*m/g, "").length;
			const pad = Math.max(0, inner - vis);
			return b("\u2502") + line + " ".repeat(pad) + b("\u2502");
		};
		return [top, ...padded.map(wrap), bot];
	}

	private borderFn?: (s: string) => string;
	private titleFn?: (s: string) => string;
	private hintFn?: (s: string) => string;
	setBorderFn(border: (s: string) => string, title: (s: string) => string): void {
		this.borderFn = border;
		this.titleFn = title;
		this.hintFn = (s: string) => border(s); // hints use border color
	}
}

export default function (pi: ExtensionAPI) {
	// --- Session lifecycle ---
	pi.on("session_start", async (_event, ctx) => {
		loadSettings(ctx.cwd);
		cachedThemeNames = EMBEDDED_THEMES.map((e) => e.name);
		await Promise.all([
			captureRunner(pi),
			initItermConnection(),
		]);

		// Reapply stored theme to both Pi UI and iTerm2 session
		const storedName = getCurrentTheme();
		if (storedName) {
			const entry = getEmbeddedThemeByName(storedName);
			if (entry) {
				const slug = slugifyThemeName(storedName);
				const params = getThemeParams(slug);
				writeAndSetPiTheme(ctx, entry.colors, storedName, params);
				applyThemeToItermSync(entry);
				updateStatus(ctx, storedName, params);
			}
		}
	});

	// --- /theme command ---
	pi.registerCommand("theme", {
		description: "Switch terminal + Pi themes with live preview",

		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const filtered = cachedThemeNames.filter((n) =>
				n.toLowerCase().startsWith(prefix.toLowerCase()),
			);
			if (filtered.length === 0) return null;
			return filtered.map((n) => ({ value: n, label: n }));
		},

		handler: async (args, ctx) => {
			const themeArg = parseCommandThemeName(args);
			if (themeArg) {
				const theme = getEmbeddedThemeByName(themeArg);
				if (!theme) {
					ctx.ui.notify(`Unknown theme: ${themeArg}`, "error");
					return;
				}
				const params = getThemeParams(slugifyThemeName(themeArg));
				writeAndSetPiTheme(ctx, theme.colors, themeArg, params);
				applyThemeToItermSync(theme);
				setCurrentTheme(themeArg);
				updateStatus(ctx, themeArg, params);
				ctx.ui.notify(`Theme "${themeArg}" applied`, "info");
				return;
			}

			const selected = await showThemePicker(pi, ctx);
			if (selected) {
				updateStatus(ctx, selected, getThemeParams(slugifyThemeName(selected)));
				ctx.ui.notify(`Theme "${selected}" applied`, "info");
			}
		},
	});

	// --- /theme-settings command ---
	pi.registerCommand("theme-settings", {
		description: "Configure theme generation settings",

		handler: async (_args, ctx) => {
			// Use the first theme in the catalog for settings preview color swatches
			const previewTheme = EMBEDDED_THEMES[0] ?? null;
			const previewColors = previewTheme?.colors ?? null;
			const currentThemeSlug = previewTheme ? slugifyThemeName(previewTheme.name) : null;
			let scope: "global" | string = "global";
			const scopeLabel = (): string => (scope === "global" ? "global" : scope);
			const paramsForScope = (): ThemeParams => (scope === "global" ? getThemeParams() : getThemeParams(scope));

			const buildItems = (): SettingItem[] => {
				const p = paramsForScope();
				const settings = getSettings();

				const weight01 = numRange(0.0, 1.0, 0.05, 2);
				const bgShiftRange = numRange(1, 30, 1, 0);
				const factorRange = numRange(0.0, 1.0, 0.1, 1);
				const tintRange = numRange(0.70, 0.99, 0.01, 2);
				const contrastRange = numRange(1.5, 6.0, 0.5, 1);
				const sourceValues = [
					...Array.from({ length: 16 }, (_, i) => `palette[${i}]`),
					"fg",
					"bg",
				];

				const bg = previewColors?.background;
				const fg = previewColors?.foreground;
				const error = previewColors ? ensureSemanticHue(resolvePaletteSourceColor(previewColors, p.errorSource), 0, p.errorFallback) : p.errorFallback;
				const success = previewColors ? ensureSemanticHue(resolvePaletteSourceColor(previewColors, p.successSource), 120, p.successFallback) : p.successFallback;
				const accent = previewColors ? (resolvePaletteSourceColor(previewColors, p.accentSource) || p.accentFallback) : p.accentFallback;
				const sourceSwatch = (source: keyof Pick<ThemeParams, "errorSource" | "successSource" | "warningSource" | "linkSource" | "accentSource" | "accentAltSource">, fallback: string): string => {
					if (!previewColors) return swatch(fallback);
					return swatch(resolvePaletteSourceColor(previewColors, p[source]) || fallback);
				};
				const globalParams = getThemeParams();
				const isOverridden = <K extends keyof ThemeParams>(key: K): boolean =>
					scope !== "global" && p[key] !== globalParams[key];
				const overridePrefix = <K extends keyof ThemeParams>(key: K): string =>
					isOverridden(key) ? "* " : "";
				const overrideDesc = <K extends keyof ThemeParams>(key: K, base: string): string =>
					isOverridden(key) ? `${base} (global: ${globalParams[key]})` : base;

				return [
					{ id: "mutedWeight", label: `${overridePrefix("mutedWeight")}${bg && fg ? `${swatch(mixColors(fg, bg, p.mutedWeight))} ` : ""}Muted text weight`, currentValue: p.mutedWeight.toFixed(2), values: weight01, description: overrideDesc("mutedWeight", "fg/bg mix for muted text (higher = more fg)") },
					{ id: "dimWeight", label: `${overridePrefix("dimWeight")}${bg && fg ? `${swatch(mixColors(fg, bg, p.dimWeight))} ` : ""}Dim text weight`, currentValue: p.dimWeight.toFixed(2), values: weight01, description: overrideDesc("dimWeight", "fg/bg mix for dim text") },
					{ id: "borderWeight", label: `${overridePrefix("borderWeight")}${bg && fg ? `${swatch(mixColors(fg, bg, p.borderWeight))} ` : ""}Border weight`, currentValue: p.borderWeight.toFixed(2), values: weight01, description: overrideDesc("borderWeight", "fg/bg mix for muted borders") },
					{ id: "bgShift", label: `${overridePrefix("bgShift")}Background shift`, currentValue: p.bgShift.toFixed(0), values: bgShiftRange, description: overrideDesc("bgShift", "Brightness offset for derived backgrounds (higher = more contrast)") },
					{ id: "selectedBgFactor", label: `${overridePrefix("selectedBgFactor")}Selected bg factor`, currentValue: p.selectedBgFactor.toFixed(1), values: factorRange, description: overrideDesc("selectedBgFactor", "Multiplier of bgShift for selected item bg") },
					{ id: "userMsgBgFactor", label: `${overridePrefix("userMsgBgFactor")}User message bg factor`, currentValue: p.userMsgBgFactor.toFixed(1), values: factorRange, description: overrideDesc("userMsgBgFactor", "Multiplier of bgShift for user message bg") },
					{ id: "toolPendingBgFactor", label: `${overridePrefix("toolPendingBgFactor")}Tool pending bg factor`, currentValue: p.toolPendingBgFactor.toFixed(1), values: factorRange, description: overrideDesc("toolPendingBgFactor", "Multiplier of bgShift for tool pending bg") },
					{ id: "toolSuccessTint", label: `${overridePrefix("toolSuccessTint")}${bg ? `${swatch(mixColors(bg, success, p.toolSuccessTint))} ` : ""}Tool success tint`, currentValue: p.toolSuccessTint.toFixed(2), values: tintRange, description: overrideDesc("toolSuccessTint", "bg/success blend (higher = more bg, subtler tint)") },
					{ id: "toolErrorTint", label: `${overridePrefix("toolErrorTint")}${bg ? `${swatch(mixColors(bg, error, p.toolErrorTint))} ` : ""}Tool error tint`, currentValue: p.toolErrorTint.toFixed(2), values: tintRange, description: overrideDesc("toolErrorTint", "bg/error blend") },
					{ id: "customMsgTint", label: `${overridePrefix("customMsgTint")}${bg ? `${swatch(mixColors(bg, accent, p.customMsgTint))} ` : ""}Custom msg tint`, currentValue: p.customMsgTint.toFixed(2), values: tintRange, description: overrideDesc("customMsgTint", "bg/accent blend for custom messages") },
					{ id: "errorSource", label: `${overridePrefix("errorSource")}${sourceSwatch("errorSource", p.errorFallback)} Error source`, currentValue: p.errorSource, values: sourceValues, description: overrideDesc("errorSource", "Source color for error semantic role") },
					{ id: "successSource", label: `${overridePrefix("successSource")}${sourceSwatch("successSource", p.successFallback)} Success source`, currentValue: p.successSource, values: sourceValues, description: overrideDesc("successSource", "Source color for success semantic role") },
					{ id: "warningSource", label: `${overridePrefix("warningSource")}${sourceSwatch("warningSource", p.warningFallback)} Warning source`, currentValue: p.warningSource, values: sourceValues, description: overrideDesc("warningSource", "Source color for warning semantic role") },
					{ id: "linkSource", label: `${overridePrefix("linkSource")}${sourceSwatch("linkSource", p.linkFallback)} Link source`, currentValue: p.linkSource, values: sourceValues, description: overrideDesc("linkSource", "Source color for link semantic role") },
					{ id: "accentSource", label: `${overridePrefix("accentSource")}${sourceSwatch("accentSource", p.accentFallback)} Accent source`, currentValue: p.accentSource, values: sourceValues, description: overrideDesc("accentSource", "Source color for accent semantic role") },
					{ id: "accentAltSource", label: `${overridePrefix("accentAltSource")}${sourceSwatch("accentAltSource", p.accentAltFallback)} Accent alt source`, currentValue: p.accentAltSource, values: sourceValues, description: overrideDesc("accentAltSource", "Source color for alternate accent role") },
					{ id: "linkContrastMin", label: `${overridePrefix("linkContrastMin")}Link contrast minimum`, currentValue: p.linkContrastMin.toFixed(1), values: contrastRange, description: overrideDesc("linkContrastMin", "Minimum contrast ratio for readable links (WCAG AA = 4.5)") },
					{ id: "previewDebounceMs", label: "Preview debounce (ms)", currentValue: settings.previewDebounceMs.toFixed(0), values: numRange(50, 1000, 50, 0), description: "Cooldown before theme preview applies (lower = faster, higher = smoother navigation)" },
				];
			};

			// Trailing-only debounce — reads latest in-memory params, never blocks input.
			const applyPreview = debounce(() => {
				if (!previewColors || !previewTheme) return;
				const slug = slugifyThemeName(previewTheme.name);
				const instance = buildThemeInstance(previewColors, `term-preview-${slug}-${Date.now()}`, paramsForScope(), ctx);
				ctx.ui.setTheme(instance);
			}, getPreviewDebounceMs());

			// Persist debounced — disk write only after 500ms of inactivity
			const schedulePersist = debounce(() => persistSettings(), 500, { trailing: true });

			const numericKeys = new Set<string>([
				"mutedWeight", "dimWeight", "borderWeight",
				"bgShift", "selectedBgFactor", "userMsgBgFactor", "toolPendingBgFactor",
				"toolSuccessTint", "toolErrorTint", "customMsgTint",
				"linkContrastMin",
			]);
			const colorKeys = new Set<string>([
				"errorFallback", "successFallback", "warningFallback",
				"linkFallback", "accentFallback", "accentAltFallback",
			]);
			const sourceKeys = new Set<string>([
				"errorSource", "successSource", "warningSource",
				"linkSource", "accentSource", "accentAltSource",
			]);

			const handleValueChange = (id: string, newValue: string): void => {
				if (id === "previewDebounceMs") {
					updateSettings({ previewDebounceMs: parseInt(newValue, 10) });
					return;
				}
				if (numericKeys.has(id)) {
					updateThemeParamInMemory(id as keyof ThemeParams, parseFloat(newValue), scope);
					applyPreview();
					schedulePersist();
					return;
				}
				if (colorKeys.has(id)) {
					const hex = newValue.startsWith("#") ? newValue : `#${newValue}`;
					if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
						updateThemeParamInMemory(id as keyof ThemeParams, hex, scope);
						applyPreview();
						schedulePersist();
					}
					return;
				}
				if (sourceKeys.has(id)) {
					updateThemeParamInMemory(id as keyof ThemeParams, newValue, scope);
					applyPreview();
					schedulePersist();
				}
			};

			await ctx.ui.custom((tui, _theme, _kb, done) => {
				const t = () => ctx.ui.theme;
				const container = new Container();

				// Indirect close — allows preview overlay cleanup to be wired in later.
				let beforeClose: (() => void) | null = null;
				const onClose = (): void => {
					beforeClose?.();
					applyPreview.cancel();
					schedulePersist.flush();
					if (previewColors && previewTheme) {
						writeAndSetPiTheme(ctx, previewColors, previewTheme.name, getThemeParams(currentThemeSlug ?? undefined));
					}
					done(undefined);
				};

				// Build initial items and keep references — mutated in place on every refresh.
				const items = buildItems();
				const headerText = new Text(t().fg("accent", t().bold(` Theme Generation Settings [${scopeLabel()}]`)), 1, 0);

				const settingsList = new SettingsList(
					items,
					12,
					{
						label: (text, selected) => selected ? t().fg("accent", text) : text,
						value: (text, selected) => selected ? t().fg("accent", text) : t().fg("muted", text),
						description: (text) => t().fg("dim", text),
						cursor: t().fg("accent", "\u2192 "),
						hint: (text) => t().fg("dim", text),
					},
					(id, newValue) => {
						handleValueChange(id, newValue);
						refreshItems();
						tui.requestRender();
					},
					onClose,
				);

				container.addChild(headerText);
				container.addChild(settingsList);
				container.addChild(new Text(t().fg("dim", " \u2190\u2192 adjust \u00B7 tab scope \u00B7 d clear \u00B7 r reset \u00B7 p preview \u00B7 n/N page"), 1, 0));

				// Theme preview overlay — non-capturing, anchored right.
				const preview = new ThemePreview();
				const updatePreview = (): void => { preview.rebuild(t); };
				updatePreview();
				const previewHandle = (tui as any).showOverlay(preview, {
					nonCapturing: true,
					anchor: "right-center",
					width: "55%",
					minWidth: 44,
					margin: { right: 1, top: 0, bottom: 0 },
				}) as OverlayHandle;

				beforeClose = () => previewHandle.hide();

				// Read SettingsList internal selected index (private but accessible at runtime).
				const getSelectedIdx = (): number => (settingsList as any).selectedIndex ?? 0;

				// Mutate existing item objects so SettingsList picks up fresh labels/swatches on next render.
				const refreshItems = (): void => {
					const fresh = buildItems();
					for (let i = 0; i < items.length; i++) {
						const src = fresh[i];
						if (!src) continue;
						items[i].label = src.label;
						items[i].description = src.description;
						items[i].currentValue = src.currentValue;
					}
					headerText.setText(t().fg("accent", t().bold(` Theme Generation Settings [${scopeLabel()}]`)));
					updatePreview();
				};

				const cycleSelected = (direction: number): void => {
					const idx = getSelectedIdx();
					const item = items[idx];
					if (!item?.values || item.values.length === 0) return;
					const curIdx = item.values.indexOf(item.currentValue);
					const nextIdx = (curIdx + direction + item.values.length) % item.values.length;
					const newValue = item.values[nextIdx]!;
					handleValueChange(item.id, newValue);
					refreshItems();
				};

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, Key.right)) {
							cycleSelected(+1);
							tui.requestRender();
							return;
						} else if (matchesKey(data, Key.left)) {
							cycleSelected(-1);
							tui.requestRender();
							return;
						} else if (matchesKey(data, Key.tab)) {
							if (!currentThemeSlug) return;
							if (scope === "global") {
								scope = currentThemeSlug;
								setOverrideEnabled(currentThemeSlug, true);
							} else {
								scope = "global";
								setOverrideEnabled(currentThemeSlug, false);
							}
							refreshItems();
							applyPreview();
							schedulePersist();
							tui.requestRender();
							return;
						} else if (data.toLowerCase() === "d") {
							if (scope === "global") return;
							const item = items[getSelectedIdx()];
							if (!item) return;
							if (Object.hasOwn(DEFAULT_THEME_PARAMS, item.id)) {
								clearOverrideParam(scope, item.id as keyof ThemeParams);
								persistSettings();
								refreshItems();
								applyPreview();
								tui.requestRender();
							}
							return;
						} else if (data === "n" || data === "N") {
							if (!previewHandle.isHidden()) {
								if (data === "n") preview.nextPage(); else preview.prevPage();
								updatePreview();
								tui.requestRender();
							}
							return;
						} else if (data.toLowerCase() === "p") {
							previewHandle.setHidden(!previewHandle.isHidden());
							tui.requestRender();
							return;
						} else if (data.toLowerCase() === "r") {
							if (scope === "global") {
								resetThemeParams("global");
							} else {
								resetThemeParams(scope);
								scope = "global";
							}
							refreshItems();
							applyPreview();
							tui.requestRender();
							return;
						}
						// Delegate everything else (up/down/enter/esc) to SettingsList.
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
