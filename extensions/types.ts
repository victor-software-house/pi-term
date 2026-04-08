/**
 * Shared types for pi-term.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Core terminal palette — background, foreground, and 16-color ANSI palette. */
export interface TerminalColors {
	background: string;
	foreground: string;
	palette: Record<number, string>;
}

/** An embedded theme entry available in the picker. */
export interface ThemeEntry {
	name: string;
	colors: TerminalColors;
	isDark: boolean;
	cursor?: string;
	cursorText?: string;
	selectionBackground?: string;
	selectionForeground?: string;
}

export type FilterMode = "all" | "dark" | "light";

export type SessionContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];
export type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

/**
 * Tunable theme generation parameters.
 * Every field has a default in DEFAULT_THEME_PARAMS — all are optional overrides.
 */
export type PaletteSource =
	| `palette[${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15}]`
	| "fg"
	| "bg";

export interface ThemeParams {
	// Text blending (fg/bg mix weights, 0.0–1.0)
	mutedWeight: number;
	dimWeight: number;
	borderWeight: number;

	// Background shift (brightness offset, 1–30)
	bgShift: number;
	// Multipliers for derived backgrounds (0.0–1.0)
	selectedBgFactor: number;
	userMsgBgFactor: number;
	toolPendingBgFactor: number;

	// Tint strength — how much base bg vs semantic color (0.80–0.99)
	toolSuccessTint: number;
	toolErrorTint: number;
	customMsgTint: number;

	// Palette role mapping sources
	errorSource: PaletteSource;
	successSource: PaletteSource;
	warningSource: PaletteSource;
	linkSource: PaletteSource;
	accentSource: PaletteSource;
	accentAltSource: PaletteSource;

	// Semantic fallback colors (hex)
	errorFallback: string;
	successFallback: string;
	warningFallback: string;
	linkFallback: string;
	accentFallback: string;
	accentAltFallback: string;

	// Minimum contrast ratio for readable links (2.0–5.0)
	linkContrastMin: number;
}

export const DEFAULT_THEME_PARAMS: ThemeParams = {
	mutedWeight: 0.65,
	dimWeight: 0.45,
	borderWeight: 0.25,

	bgShift: 12,
	selectedBgFactor: 1.0,
	userMsgBgFactor: 0.7,
	toolPendingBgFactor: 0.4,

	toolSuccessTint: 0.88,
	toolErrorTint: 0.88,
	customMsgTint: 0.92,

	errorSource: "palette[1]",
	successSource: "palette[2]",
	warningSource: "palette[3]",
	linkSource: "palette[4]",
	accentSource: "palette[5]",
	accentAltSource: "palette[6]",

	errorFallback: "#cc6666",
	successFallback: "#98c379",
	warningFallback: "#e5c07b",
	linkFallback: "#61afef",
	accentFallback: "#c678dd",
	accentAltFallback: "#56b6c2",

	linkContrastMin: 3.0,
};
