/**
 * Pi theme generation and file management for pi-term.
 *
 * Converts a terminal palette into a full Pi theme JSON, writes permanent
 * theme files, and builds in-memory Theme instances for live preview.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
	getLuminance,
	adjustBrightness,
	mixColors,
	ensureSemanticHue,
	pickReadableLink,
} from "./colors.js";
import type { TerminalColors, PaletteSource, SessionContext, ThemeParams } from "./types.js";

export const PI_THEMES_DIR = join(homedir(), ".pi", "agent", "themes");
export function slugifyThemeName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function ensureThemesDir(): void {
	if (!existsSync(PI_THEMES_DIR)) {
		mkdirSync(PI_THEMES_DIR, { recursive: true });
	}
}

function computeThemeHash(colors: TerminalColors): string {
	const parts: string[] = [];
	parts.push(`bg=${colors.background}`);
	parts.push(`fg=${colors.foreground}`);
	for (let i = 0; i <= 15; i++) parts.push(`p${i}=${colors.palette[i] ?? ""}`);
	const signature = parts.join("\n");
	return createHash("sha1").update(signature).digest("hex").slice(0, 8);
}

export function resolvePaletteSourceColor(colors: TerminalColors, source: PaletteSource): string | undefined {
	if (source === "fg") return colors.foreground;
	if (source === "bg") return colors.background;
	const match = source.match(/^palette\[(\d{1,2})\]$/);
	if (!match) return undefined;
	const index = Number.parseInt(match[1]!, 10);
	if (index < 0 || index > 15) return undefined;
	return colors.palette[index];
}

function cleanupOldSyncThemes(keepFiles: string[]): void {
	const keep = new Set(keepFiles);
	try {
		for (const file of readdirSync(PI_THEMES_DIR)) {
			if (keep.has(file)) continue;
			// Remove legacy artifacts from old package names
			if (file === "ghostty-sync.json") {
				unlinkSync(join(PI_THEMES_DIR, file));
				continue;
			}
			if (file.startsWith("ghostty-sync-") && file.endsWith(".json")) {
				unlinkSync(join(PI_THEMES_DIR, file));
				continue;
			}
			if (file.startsWith("cmux-sync-") && file.endsWith(".json")) {
				unlinkSync(join(PI_THEMES_DIR, file));
				continue;
			}
			if (file.startsWith("term-sync-") && file.endsWith(".json")) {
				unlinkSync(join(PI_THEMES_DIR, file));
				continue;
			}
		}
	} catch {
		// Best-effort cleanup
	}
}

/** All resolved theme colors computed from terminal palette + params. */
export interface ResolvedColors {
	bg: string; fg: string;
	error: string; success: string; warning: string; link: string;
	accent: string; accentAlt: string;
	muted: string; dim: string; borderMuted: string;
	selectedBg: string; userMsgBg: string;
	toolPendingBg: string; toolSuccessBg: string; toolErrorBg: string;
	customMsgBg: string;
}

/** Compute all derived theme colors from terminal colors + params. */
export function resolveThemeColors(colors: TerminalColors, p: ThemeParams): ResolvedColors {
	const bg = colors.background;
	const fg = colors.foreground;
	const isDark = getLuminance(bg) < 0.5;

	const error = ensureSemanticHue(resolvePaletteSourceColor(colors, p.errorSource), 0, p.errorFallback);
	const success = ensureSemanticHue(resolvePaletteSourceColor(colors, p.successSource), 120, p.successFallback);
	const warning = ensureSemanticHue(resolvePaletteSourceColor(colors, p.warningSource), 50, p.warningFallback);
	const rawLink = ensureSemanticHue(resolvePaletteSourceColor(colors, p.linkSource), 220, p.linkFallback);
	const link = pickReadableLink(rawLink, bg, p.linkFallback, fg, p.linkContrastMin);

	const accent = resolvePaletteSourceColor(colors, p.accentSource) || p.accentFallback;
	const accentAlt = resolvePaletteSourceColor(colors, p.accentAltSource) || p.accentAltFallback;

	const muted = mixColors(fg, bg, p.mutedWeight);
	const dim = mixColors(fg, bg, p.dimWeight);
	const borderMuted = mixColors(fg, bg, p.borderWeight);

	const bgShift = isDark ? p.bgShift : -p.bgShift;
	const selectedBg = adjustBrightness(bg, Math.round(bgShift * p.selectedBgFactor));
	const userMsgBg = adjustBrightness(bg, Math.round(bgShift * p.userMsgBgFactor));
	const toolPendingBg = adjustBrightness(bg, Math.round(bgShift * p.toolPendingBgFactor));
	const toolSuccessBg = mixColors(bg, success, p.toolSuccessTint);
	const toolErrorBg = mixColors(bg, error, p.toolErrorTint);
	const customMsgBg = mixColors(bg, accent, p.customMsgTint);

	return {
		bg, fg, error, success, warning, link, accent, accentAlt,
		muted, dim, borderMuted, selectedBg, userMsgBg,
		toolPendingBg, toolSuccessBg, toolErrorBg, customMsgBg,
	};
}

export function generatePiTheme(colors: TerminalColors, themeName: string, p: ThemeParams): object {
	const c = resolveThemeColors(colors, p);

	return {
		$schema: "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
		name: themeName,
		vars: {
			bg: c.bg, fg: c.fg, accent: c.accent, accentAlt: c.accentAlt,
			link: c.link, error: c.error, success: c.success, warning: c.warning,
			muted: c.muted, dim: c.dim, borderMuted: c.borderMuted,
			selectedBg: c.selectedBg, userMsgBg: c.userMsgBg,
			toolPendingBg: c.toolPendingBg, toolSuccessBg: c.toolSuccessBg,
			toolErrorBg: c.toolErrorBg, customMsgBg: c.customMsgBg,
		},
		colors: {
			accent: "accent",
			border: "borderMuted",
			borderAccent: "accent",
			borderMuted: "borderMuted",
			success: "success",
			error: "error",
			warning: "warning",
			muted: "muted",
			dim: "dim",
			text: "",
			thinkingText: "muted",
			selectedBg: "selectedBg",
			userMessageBg: "userMsgBg",
			userMessageText: "",
			customMessageBg: "customMsgBg",
			customMessageText: "",
			customMessageLabel: "accent",
			toolPendingBg: "toolPendingBg",
			toolSuccessBg: "toolSuccessBg",
			toolErrorBg: "toolErrorBg",
			toolTitle: "",
			toolOutput: "muted",
			mdHeading: "warning",
			mdLink: "link",
			mdLinkUrl: "dim",
			mdCode: "accent",
			mdCodeBlock: "success",
			mdCodeBlockBorder: "muted",
			mdQuote: "muted",
			mdQuoteBorder: "muted",
			mdHr: "muted",
			mdListBullet: "accent",
			toolDiffAdded: "success",
			toolDiffRemoved: "error",
			toolDiffContext: "muted",
			syntaxComment: "muted",
			syntaxKeyword: "accent",
			syntaxFunction: "link",
			syntaxVariable: "accentAlt",
			syntaxString: "success",
			syntaxNumber: "accent",
			syntaxType: "accentAlt",
			syntaxOperator: "fg",
			syntaxPunctuation: "muted",
			thinkingOff: "borderMuted",
			thinkingMinimal: "muted",
			thinkingLow: "link",
			thinkingMedium: "accentAlt",
			thinkingHigh: "accent",
			thinkingXhigh: "accent",
			bashMode: "success",
		},
		export: {
			pageBg: getLuminance(c.bg) < 0.5 ? adjustBrightness(c.bg, -8) : adjustBrightness(c.bg, 8),
			cardBg: c.bg,
			infoBg: mixColors(c.bg, c.warning, 0.88),
		},
	};
}

/**
 * Write permanent theme, clean up old sync files, apply via setTheme.
 * Only call on final confirm — not during live preview (cleanup is expensive).
 */
export function writeAndSetPiTheme(ctx: SessionContext, colors: TerminalColors, sourceThemeName: string, p: ThemeParams): string {
	ensureThemesDir();
	const hash = computeThemeHash(colors);
	const slug = slugifyThemeName(sourceThemeName);
	const themeName = slug ? `term-sync-${slug}` : `term-sync-${hash}`;
	const themeFile = `${themeName}.json`;
	const themePath = join(PI_THEMES_DIR, themeFile);

	const themeJson = generatePiTheme(colors, themeName, p);
	writeFileSync(themePath, JSON.stringify(themeJson, null, 2));
	cleanupOldSyncThemes([themeFile]);

	// Register the constant name with Pi's settingsManager so it persists across restarts.
	// This loads a potentially stale cached instance — we immediately override it below.
	ctx.ui.setTheme(themeName);

	// Apply a uniquely-named instance so renderer caches (keyed on theme.name) always
	// invalidate. File name stays constant; in-memory name is ephemeral.
	const instance = buildThemeInstance(colors, `${themeName}-${Date.now()}`, p, ctx);
	ctx.ui.setTheme(instance);
	return themeName;
}

/** Background color keys — same set as Pi's internal createTheme. */
const BG_COLOR_KEYS = new Set([
	"selectedBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

/**
 * Build a Theme instance entirely in memory from TerminalColors + ThemeParams.
 * No file I/O — passes directly to ctx.ui.setTheme(instance).
 *
 * Uses ctx.ui.theme.constructor (not an import) to get the exact Theme class
 * identity that Pi's internal setTheme instanceof check requires.
 */
export function buildThemeInstance(
	colors: TerminalColors,
	themeName: string,
	p: ThemeParams,
	ctx: SessionContext,
): InstanceType<typeof import("@mariozechner/pi-coding-agent").Theme> {
	const json = generatePiTheme(colors, themeName, p) as {
		vars: Record<string, string>;
		colors: Record<string, string>;
	};

	// Replicate Pi's resolveThemeColors: map color role → hex via vars
	const fgColors: Record<string, string> = {};
	const bgColors: Record<string, string> = {};
	for (const [key, val] of Object.entries(json.colors)) {
		const hex = val === "" || val.startsWith("#") ? val : (json.vars[val] ?? val);
		if (BG_COLOR_KEYS.has(key)) bgColors[key] = hex;
		else fgColors[key] = hex;
	}

	// Must use the constructor from the live theme instance — NOT a static import.
	// Pi's setTheme does `instanceof Theme` against its own module-internal class.
	// A separate require/import gets a different module instance and instanceof fails.
	const ThemeClass = (ctx.ui.theme as any).constructor;
	return new ThemeClass(fgColors, bgColors, "truecolor", { name: themeName });
}

