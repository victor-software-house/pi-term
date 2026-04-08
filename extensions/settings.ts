/**
 * Extension settings — persisted as JSON on disk.
 *
 * Config files (project overrides global):
 *   ~/.pi/agent/extensions/pi-term.json  (global)
 *   <cwd>/.pi/extensions/pi-term.json    (project)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { DEFAULT_THEME_PARAMS, type ThemeParams } from "./types.js";

const CONFIG_FILENAME = "pi-term.json";

export interface ThemeOverride {
	enabled: boolean;
	params: Partial<ThemeParams>;
}

export interface Settings {
	themeParams: ThemeParams;
	previewDebounceMs: number;
	themeOverrides: Record<string, ThemeOverride>;
}

const DEFAULTS: Settings = {
	themeParams: { ...DEFAULT_THEME_PARAMS },
	previewDebounceMs: 50,
	themeOverrides: {},
};

let current: Settings = {
	...DEFAULTS,
	themeParams: { ...DEFAULTS.themeParams },
	themeOverrides: {},
};

// --- Paths ---

function globalConfigPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_FILENAME);
}

function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "extensions", CONFIG_FILENAME);
}

// --- Read / write ---

function readConfigFile(path: string): Partial<Settings> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Partial<Settings>;
	} catch {
		return {};
	}
}

function writeConfigFile(path: string, data: Settings): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function mergeThemeOverrides(
	globalOverrides: Record<string, ThemeOverride> | undefined,
	projectOverrides: Record<string, ThemeOverride> | undefined,
): Record<string, ThemeOverride> {
	const merged = { ...(globalOverrides ?? {}), ...(projectOverrides ?? {}) };
	const normalized: Record<string, ThemeOverride> = {};
	for (const [slug, override] of Object.entries(merged)) {
		normalized[slug] = {
			enabled: override?.enabled === true,
			params: { ...(override?.params ?? {}) },
		};
	}
	return normalized;
}

// --- Public API ---

export function getSettings(): Settings {
	return current;
}

export function getThemeParams(themeSlug?: string): ThemeParams {
	if (!themeSlug) return current.themeParams;
	const override = current.themeOverrides[themeSlug];
	if (!override?.enabled) return current.themeParams;
	return { ...current.themeParams, ...override.params };
}

export function getPreviewDebounceMs(): number {
	return current.previewDebounceMs;
}

/** Load settings from disk (global, then project override). */
export function loadSettings(cwd: string): void {
	const globalConfig = readConfigFile(globalConfigPath());
	const projectConfig = readConfigFile(projectConfigPath(cwd));
	const merged = { ...globalConfig, ...projectConfig };
	current = {
		...DEFAULTS,
		...merged,
		themeParams: { ...DEFAULT_THEME_PARAMS, ...(merged.themeParams ?? {}) },
		themeOverrides: mergeThemeOverrides(globalConfig.themeOverrides, projectConfig.themeOverrides),
	};
}

/** Update in-memory settings and persist to global config. */
export function updateSettings(patch: Partial<Settings>): void {
	if (patch.themeParams) {
		current = { ...current, ...patch, themeParams: { ...current.themeParams, ...patch.themeParams } };
	} else if (patch.themeOverrides) {
		current = { ...current, ...patch, themeOverrides: { ...current.themeOverrides, ...patch.themeOverrides } };
	} else {
		current = { ...current, ...patch };
	}
	writeConfigFile(globalConfigPath(), current);
}

function ensureOverride(scope: string): ThemeOverride {
	if (!current.themeOverrides[scope]) {
		current.themeOverrides[scope] = { enabled: true, params: {} };
	}
	return current.themeOverrides[scope]!;
}

/** Update a single theme param in memory only — call persistSettings() when done. */
export function updateThemeParamInMemory<K extends keyof ThemeParams>(
	key: K,
	value: ThemeParams[K],
	scope: "global" | string = "global",
): void {
	if (scope === "global") {
		current.themeParams[key] = value;
		return;
	}
	const override = ensureOverride(scope);
	override.enabled = true;
	override.params[key] = value;
}

export function setOverrideEnabled(themeSlug: string, enabled: boolean): void {
	const override = ensureOverride(themeSlug);
	override.enabled = enabled;
}

export function clearOverrideParam(themeSlug: string, key: keyof ThemeParams): void {
	const override = current.themeOverrides[themeSlug];
	if (!override) return;
	delete override.params[key];
}

export function clearAllOverrides(themeSlug: string): void {
	delete current.themeOverrides[themeSlug];
}

/** Reset theme params to defaults (global or scoped override) and persist to global config. */
export function resetThemeParams(scope: "global" | string = "global"): void {
	if (scope === "global") {
		current.themeParams = { ...DEFAULT_THEME_PARAMS };
	} else {
		clearAllOverrides(scope);
	}
	writeConfigFile(globalConfigPath(), current);
}

/** Persist current in-memory settings to global config. */
export function persistSettings(): void {
	writeConfigFile(globalConfigPath(), current);
}
