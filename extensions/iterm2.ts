/**
 * iTerm2 live theme adapter for pi-term.
 *
 * Uses a persistent Python bridge process that communicates with iTerm2's
 * batched protobuf API. All 22 color properties are set in a single message
 * (~14ms per apply with 200ms debounce gaps).
 *
 * The bridge is started once at session_start (~150ms). Theme applies are
 * fire-and-forget writes to the bridge's stdin — never blocking the caller.
 *
 * Snapshot/restore for cancel goes through the same bridge.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { join } from "node:path";
import type { ThemeEntry } from "./types.js";

/** RGB snapshot of all managed color properties. */
export interface ItermThemeSnapshot {
	[key: string]: { r: number; g: number; b: number };
}

// --- Bridge process ---

let _bridge: ChildProcess | null = null;
let _bridgeRl: ReadlineInterface | null = null;
let _ready = false;
let _pendingReads: Array<(data: any) => void> = [];

// Kill bridge when Pi exits
process.on("exit", () => { if (_bridge && !_bridge.killed) _bridge.kill(); });
process.on("SIGTERM", () => { if (_bridge && !_bridge.killed) _bridge.kill(); process.exit(0); });

function bridgePath(): string {
	return join(__dirname, "iterm2-bridge.py");
}

function readBridgeLine(): Promise<any> {
	return new Promise((resolve) => {
		_pendingReads.push(resolve);
	});
}

function sendBridgeCommand(cmd: Record<string, unknown>): void {
	if (!_bridge?.stdin?.writable) return;
	_bridge.stdin.write(JSON.stringify(cmd) + "\n");
}

/**
 * Start the bridge process. Call once at session_start.
 * ~150ms startup cost absorbed here — not during picker use.
 */
export async function initItermConnection(): Promise<void> {
	if (_bridge && !_bridge.killed) return;
	try {
		_bridge = spawn("python3", [bridgePath()], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		_bridgeRl = createInterface({ input: _bridge.stdout! });
		_bridgeRl.on("line", (line) => {
			try {
				const data = JSON.parse(line);
				const resolve = _pendingReads.shift();
				if (resolve) resolve(data);
			} catch {}
		});
		_bridge.on("exit", () => {
			_ready = false;
			_bridge = null;
			_bridgeRl = null;
		});

		// Wait for ready signal
		const readyMsg = await readBridgeLine();
		_ready = readyMsg?.ready === true;
	} catch {
		_ready = false;
		_bridge = null;
	}
}

/** Check if the bridge is alive and ready. */
export function isItermReady(): boolean {
	return _ready && _bridge !== null && !_bridge.killed;
}

export function disconnectIterm(): void {
	if (_bridge && !_bridge.killed) {
		sendBridgeCommand({ cmd: "quit" });
		_bridge.kill();
	}
	_bridge = null;
	_bridgeRl = null;
	_ready = false;
}

// --- Helpers ---

function themeToColorMap(theme: ThemeEntry): Record<string, string> {
	const m: Record<string, string> = {};
	m["Background Color"] = theme.colors.background.replace("#", "");
	m["Foreground Color"] = theme.colors.foreground.replace("#", "");
	if (theme.cursor) m["Cursor Color"] = theme.cursor.replace("#", "");
	if (theme.cursorText) m["Cursor Text Color"] = theme.cursorText.replace("#", "");
	if (theme.selectionBackground) m["Selection Color"] = theme.selectionBackground.replace("#", "");
	if (theme.selectionForeground) m["Selected Text Color"] = theme.selectionForeground.replace("#", "");
	for (let i = 0; i < 16; i++) {
		const hex = theme.colors.palette[i];
		if (hex) m[`Ansi ${i} Color`] = hex.replace("#", "");
	}
	return m;
}

export function hexToItermColor(hex: string): { "Red Component": number; "Green Component": number; "Blue Component": number; "Alpha Component": number; "Color Space": string } {
	const n = hex.replace("#", "");
	return {
		"Red Component": parseInt(n.slice(0, 2), 16) / 255,
		"Green Component": parseInt(n.slice(2, 4), 16) / 255,
		"Blue Component": parseInt(n.slice(4, 6), 16) / 255,
		"Alpha Component": 1,
		"Color Space": "sRGB",
	};
}

// --- Public API ---

/**
 * Apply a theme — fire-and-forget. Writes to bridge stdin without awaiting response.
 * ~14ms on the bridge side (batched protobuf), 0ms from the caller's perspective.
 */
export function applyThemeToItermSync(theme: ThemeEntry): void {
	if (!isItermReady()) return;
	sendBridgeCommand({ cmd: "apply", colors: themeToColorMap(theme) });
}

/**
 * Capture current color snapshot. Async — waits for bridge response (~14ms).
 * Call once at picker open.
 */
export async function captureItermSnapshot(): Promise<ItermThemeSnapshot | null> {
	if (!isItermReady()) return null;
	sendBridgeCommand({ cmd: "snapshot" });
	const response = await readBridgeLine();
	if (response?.ok && response.snapshot) return response.snapshot;
	return null;
}

/**
 * Restore a snapshot — fire-and-forget. 0ms from the caller's perspective.
 */
export function restoreSnapshotSync(snapshot: ItermThemeSnapshot): void {
	if (!isItermReady()) return;
	sendBridgeCommand({ cmd: "restore", snapshot });
}

/**
 * Persist theme to the actual iTerm2 profile — survives new tabs/windows.
 * Fire-and-forget. Call on confirm only, not during preview.
 */
export function persistThemeToProfile(theme: ThemeEntry): void {
	if (!isItermReady()) return;
	sendBridgeCommand({ cmd: "persist", colors: themeToColorMap(theme) });
}

// --- Legacy async wrappers ---

export async function applyThemeToIterm(theme: ThemeEntry, _sessionId: string): Promise<void> {
	applyThemeToItermSync(theme);
}

export async function getSessionId(): Promise<string | null> {
	return isItermReady() ? "bridge" : null;
}

export async function restoreItermSnapshot(snapshot: ItermThemeSnapshot): Promise<void> {
	restoreSnapshotSync(snapshot);
}
