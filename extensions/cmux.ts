/**
 * cmux CLI interaction — reading theme files, listing/setting themes.
 *
 * Source of truth: cmux bundled Ghostty theme files at CMUX_THEME_DIR.
 */

import { execFile, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeColor, getLuminance } from "./colors.js";
import type { TerminalColors, ThemeEntry } from "./types.js";

const CMUX_THEME_DIR = "/Applications/cmux.app/Contents/Resources/ghostty/themes";

export function getCurrentCmuxThemeName(): string | null {
	try {
		const output = execSync("cmux themes list", {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		for (const line of output.split("\n")) {
			if (line.startsWith("Current dark:")) return line.replace("Current dark:", "").trim();
		}
		for (const line of output.split("\n")) {
			if (line.startsWith("Current light:")) return line.replace("Current light:", "").trim();
		}
		return null;
	} catch {
		return null;
	}
}

export function runCmuxThemeSet(themeName: string): void {
	execFile("cmux", ["themes", "set", themeName], { timeout: 5000 }, () => {
		// Fire-and-forget by design
	});
}

export function getCmuxThemeColors(themeName: string): TerminalColors | null {
	try {
		const themePath = join(CMUX_THEME_DIR, themeName);
		if (!existsSync(themePath)) return null;
		const output = readFileSync(themePath, "utf-8");
		return parseThemeConfig(output);
	} catch {
		return null;
	}
}

export function getAvailableCmuxThemes(): ThemeEntry[] {
	try {
		const names = readdirSync(CMUX_THEME_DIR).sort((a, b) => a.localeCompare(b));
		const entries: ThemeEntry[] = [];
		for (const name of names) {
			const colors = getCmuxThemeColors(name);
			if (!colors) continue;
			entries.push({
				name,
				colors,
				isDark: getLuminance(colors.background) < 0.5,
			});
		}
		return entries;
	} catch {
		return [];
	}
}

function parseThemeConfig(output: string): TerminalColors {
	const colors: TerminalColors = {
		background: "#1e1e1e",
		foreground: "#d4d4d4",
		palette: {},
	};

	for (const line of output.split("\n")) {
		const match = line.match(/^(\S+)\s*=\s*(.+)$/);
		if (!match) continue;

		const [, key, value] = match;
		const trimmedValue = value!.trim();

		if (key === "background") {
			colors.background = normalizeColor(trimmedValue);
		} else if (key === "foreground") {
			colors.foreground = normalizeColor(trimmedValue);
		} else if (key === "palette") {
			const paletteMatch = trimmedValue.match(/^(\d+)=(.+)$/);
			if (paletteMatch) {
				const index = parseInt(paletteMatch[1]!, 10);
				if (index >= 0 && index <= 15) {
					colors.palette[index] = normalizeColor(paletteMatch[2]!);
				}
			}
		}
	}

	return colors;
}
