/**
 * iTerm2 live theme adapter for pi-term.
 *
 * Uses @shadr/iterm2-ts (WebSocket/protobuf) to apply and restore terminal
 * color properties on the active iTerm2 session.
 *
 * Critical: always use Promise.all for multi-property operations.
 * Sequential apply takes ~2300ms; parallel takes ~260ms.
 *
 * Connection lifecycle: connect once when picker opens, disconnect on close.
 * Reconnect cost is ~300ms — absorb it at picker open, not during preview.
 */

import type { ITerm2 } from "@shadr/iterm2-ts";
import { connect } from "@shadr/iterm2-ts";
import type { ThemeEntry } from "./types.js";

/** iTerm2 color property keys this adapter manages. */
const COLOR_KEYS = [
	"Background Color",
	"Foreground Color",
	"Cursor Color",
	"Cursor Text Color",
	"Selection Color",
	"Selected Text Color",
	...Array.from({ length: 16 }, (_, i) => `Ansi ${i} Color`),
] as const;

export type ItermColorKey = (typeof COLOR_KEYS)[number];

/** iTerm2 JSON color object format (0-1 float components). */
export interface ItermColor {
	"Red Component": number;
	"Green Component": number;
	"Blue Component": number;
	"Alpha Component": number;
	"Color Space": string;
}

/** Captured snapshot of all managed color properties for one session. */
export interface ItermThemeSnapshot {
	sessionId: string;
	values: Record<string, unknown>;
}

// --- Connection ---

let _conn: ITerm2 | null = null;

export async function ensureItermConnection(): Promise<ITerm2> {
	if (_conn?.isConnected) return _conn;
	_conn = await connect({ advisoryName: "pi-term" });
	return _conn;
}

export function disconnectIterm(): void {
	if (_conn) {
		_conn.disconnect();
		_conn = null;
	}
}

// --- Helpers ---

export function hexToItermColor(hex: string): ItermColor {
	const n = hex.replace("#", "");
	if (n.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
	return {
		"Red Component": parseInt(n.slice(0, 2), 16) / 255,
		"Green Component": parseInt(n.slice(2, 4), 16) / 255,
		"Blue Component": parseInt(n.slice(4, 6), 16) / 255,
		"Alpha Component": 1,
		"Color Space": "sRGB",
	};
}

function buildColorAssignments(theme: ThemeEntry): Array<{ key: string; value: ItermColor }> {
	const { colors, cursor, cursorText, selectionBackground, selectionForeground } = theme;
	const assignments: Array<{ key: string; value: ItermColor }> = [
		{ key: "Background Color", value: hexToItermColor(colors.background) },
		{ key: "Foreground Color", value: hexToItermColor(colors.foreground) },
	];
	if (cursor) assignments.push({ key: "Cursor Color", value: hexToItermColor(cursor) });
	if (cursorText) assignments.push({ key: "Cursor Text Color", value: hexToItermColor(cursorText) });
	if (selectionBackground) assignments.push({ key: "Selection Color", value: hexToItermColor(selectionBackground) });
	if (selectionForeground) assignments.push({ key: "Selected Text Color", value: hexToItermColor(selectionForeground) });
	for (let i = 0; i < 16; i++) {
		const hex = colors.palette[i];
		if (hex) assignments.push({ key: `Ansi ${i} Color`, value: hexToItermColor(hex) });
	}
	return assignments;
}

// --- Public API ---

/** Returns the active session ID or null if iTerm2 is not reachable. */
export async function getActiveItermSessionId(): Promise<string | null> {
	try {
		const iterm = await ensureItermConnection();
		const app = await iterm.getApp();
		return app.windows[0]?.tabs[0]?.sessions[0]?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Capture current color property values for a session.
 * Uses Promise.all — reads all 22 properties in parallel.
 */
export async function captureItermSnapshot(sessionId: string): Promise<ItermThemeSnapshot> {
	const iterm = await ensureItermConnection();
	const values: Record<string, unknown> = {};
	await Promise.all(
		COLOR_KEYS.map(async (key) => {
			values[key] = await iterm.getProfileProperty(sessionId, key);
		}),
	);
	return { sessionId, values };
}

/**
 * Apply a theme to an iTerm2 session.
 * Uses Promise.all — applies all properties in parallel (~260ms).
 */
export async function applyThemeToIterm(theme: ThemeEntry, sessionId: string): Promise<void> {
	const iterm = await ensureItermConnection();
	const assignments = buildColorAssignments(theme);
	await Promise.all(
		assignments.map(({ key, value }) => iterm.setProfileProperty(sessionId, key, value)),
	);
}

/**
 * Restore a previously captured snapshot.
 * Uses Promise.all — restores all properties in parallel (~300ms).
 */
export async function restoreItermSnapshot(snapshot: ItermThemeSnapshot): Promise<void> {
	const iterm = await ensureItermConnection();
	await Promise.all(
		Object.entries(snapshot.values).map(([key, value]) =>
			iterm.setProfileProperty(snapshot.sessionId, key, value),
		),
	);
}
