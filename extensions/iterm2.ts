/**
 * iTerm2 live theme adapter for pi-term.
 *
 * Theme APPLY uses terminal escape sequences (OSC 10/11/12/4) — synchronous,
 * zero-overhead, no connection needed. Just process.stdout.write().
 *
 * Theme SNAPSHOT (for cancel/restore) uses @shadr/iterm2-ts WebSocket to read
 * current profile properties. This is a one-shot operation at picker open.
 *
 * Theme RESTORE writes the snapshot values back via escape sequences.
 */

import type { ITerm2 } from "@shadr/iterm2-ts";
import { connect } from "@shadr/iterm2-ts";
import type { ThemeEntry } from "./types.js";

/** iTerm2 color property keys for snapshot capture. */
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
	values: Record<string, ItermColor>;
}

// --- Session ID cache ---

let _cachedSessionId: string | null = null;

/**
 * Discover and cache the active session ID.
 * Call once at session_start.
 */
export async function initItermConnection(): Promise<void> {
	try {
		const iterm = await connect({ advisoryName: "pi-term" });
		const app = await iterm.getApp();
		_cachedSessionId = app.windows[0]?.tabs[0]?.sessions[0]?.id ?? null;
		iterm.disconnect();
	} catch {
		_cachedSessionId = null;
	}
}

/** Return cached session ID. */
export async function getSessionId(): Promise<string | null> {
	if (_cachedSessionId) return _cachedSessionId;
	try {
		const iterm = await connect({ advisoryName: "pi-term" });
		const app = await iterm.getApp();
		_cachedSessionId = app.windows[0]?.tabs[0]?.sessions[0]?.id ?? null;
		iterm.disconnect();
		return _cachedSessionId;
	} catch {
		return null;
	}
}

/** Check if a session ID has been cached. */
export function isItermReady(): boolean {
	return _cachedSessionId !== null;
}

/** No-op — connections are per-operation. */
export function disconnectIterm(): void {}

// --- Escape sequence helpers ---

/** File descriptor for /dev/tty — bypasses Pi's stdout/TUI entirely. */
let _ttyFd: number | null = null;

function getTtyFd(): number {
	if (_ttyFd === null) {
		const { openSync } = require("node:fs") as typeof import("node:fs");
		_ttyFd = openSync("/dev/tty", "w");
	}
	return _ttyFd;
}

function hexToOsc(hex: string): string {
	const n = hex.replace("#", "");
	return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4, 6)}`;
}

function itermColorToHex(c: ItermColor): string {
	const r = Math.round(c["Red Component"] * 255).toString(16).padStart(2, "0");
	const g = Math.round(c["Green Component"] * 255).toString(16).padStart(2, "0");
	const b = Math.round(c["Blue Component"] * 255).toString(16).padStart(2, "0");
	return `#${r}${g}${b}`;
}

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

// --- Escape sequence apply (synchronous, 0ms) ---

/**
 * Apply a theme to iTerm2 via escape sequences.
 * Completely synchronous — no connection, no async, no overhead.
 */
export function applyThemeToItermSync(theme: ThemeEntry): void {
	const { writeSync } = require("node:fs") as typeof import("node:fs");
	const fd = getTtyFd();
	const seqs: string[] = [];
	seqs.push(`\x1b]11;rgb:${hexToOsc(theme.colors.background)}\x07`);
	seqs.push(`\x1b]10;rgb:${hexToOsc(theme.colors.foreground)}\x07`);
	if (theme.cursor) seqs.push(`\x1b]12;rgb:${hexToOsc(theme.cursor)}\x07`);
	for (let i = 0; i < 16; i++) {
		const hex = theme.colors.palette[i];
		if (hex) seqs.push(`\x1b]4;${i};rgb:${hexToOsc(hex)}\x07`);
	}
	writeSync(fd, seqs.join(""));
}

/**
 * Restore colors from a snapshot via escape sequences.
 * Completely synchronous — no connection, no async, no overhead.
 */
export function restoreSnapshotSync(snapshot: ItermThemeSnapshot): void {
	const { writeSync } = require("node:fs") as typeof import("node:fs");
	const fd = getTtyFd();
	const v = snapshot.values;
	const seqs: string[] = [];
	if (v["Background Color"]) seqs.push(`\x1b]11;rgb:${hexToOsc(itermColorToHex(v["Background Color"]))}\x07`);
	if (v["Foreground Color"]) seqs.push(`\x1b]10;rgb:${hexToOsc(itermColorToHex(v["Foreground Color"]))}\x07`);
	if (v["Cursor Color"]) seqs.push(`\x1b]12;rgb:${hexToOsc(itermColorToHex(v["Cursor Color"]))}\x07`);
	for (let i = 0; i < 16; i++) {
		const c = v[`Ansi ${i} Color`];
		if (c) seqs.push(`\x1b]4;${i};rgb:${hexToOsc(itermColorToHex(c))}\x07`);
	}
	writeSync(fd, seqs.join(""));
}

// --- WebSocket snapshot (one-shot, async) ---

/**
 * Capture current color property values via WebSocket.
 * Fresh connection, parallel read, disconnect. ~90ms one-shot cost at picker open.
 */
export async function captureItermSnapshot(sessionId: string): Promise<ItermThemeSnapshot> {
	const iterm = await connect({ advisoryName: "pi-term" });
	const values: Record<string, ItermColor> = {};
	await Promise.all(
		COLOR_KEYS.map(async (key) => {
			const v = await iterm.getProfileProperty(sessionId, key);
			if (v && typeof v === "object") values[key] = v as ItermColor;
		}),
	);
	iterm.disconnect();
	return { sessionId, values };
}

// --- Legacy async wrappers (kept for API compat, delegate to sync) ---

export async function applyThemeToIterm(theme: ThemeEntry, _sessionId: string): Promise<void> {
	applyThemeToItermSync(theme);
}

export async function restoreItermSnapshot(snapshot: ItermThemeSnapshot): Promise<void> {
	restoreSnapshotSync(snapshot);
}
