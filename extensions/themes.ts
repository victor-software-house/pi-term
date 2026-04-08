/**
 * Embedded theme catalog for pi-term.
 *
 * Themes are stored directly in this file — no runtime file system discovery.
 * Each theme maps directly to an iTerm2 color set and feeds into Pi theme generation.
 *
 * Source: mbadolato/iTerm2-Color-Schemes (ghostty format)
 */

import { getLuminance } from "./colors.js";
import type { ThemeEntry } from "./types.js";

const raw: Omit<ThemeEntry, "isDark">[] = [
	{
		name: "Tomorrow Night Burns",
		colors: {
			background: "#151515",
			foreground: "#a1b0b8",
			palette: {
				0: "#252525", 1: "#832e31", 2: "#a63c40", 3: "#d3494e",
				4: "#fc595f", 5: "#df9395", 6: "#ba8586", 7: "#f5f5f5",
				8: "#5d6f71", 9: "#832e31", 10: "#a63c40", 11: "#d2494e",
				12: "#fc595f", 13: "#df9395", 14: "#ba8586", 15: "#f5f5f5",
			},
		},
		cursor: "#ff443e",
		cursorText: "#b0c2c4",
		selectionBackground: "#b0bec5",
		selectionForeground: "#2a2d32",
	},
];

/** All embedded themes with isDark computed from background luminance. */
export const EMBEDDED_THEMES: ThemeEntry[] = raw.map((t) => ({
	...t,
	isDark: getLuminance(t.colors.background) < 0.5,
}));

/** Look up an embedded theme by exact name. */
export function getEmbeddedThemeByName(name: string): ThemeEntry | undefined {
	return EMBEDDED_THEMES.find((t) => t.name === name);
}
