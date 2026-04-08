/**
 * iTerm2 adapter for pi-term.
 *
 * Preview: OSC escape sequences to /dev/tty (0ms, synchronous).
 * Persist: direct plist write to iTerm2 preferences (~26ms, non-blocking).
 * Snapshot: Python bridge for one-shot read of current session colors.
 *
 * No API calls in the hot path. The bridge is only used at picker open
 * for snapshot capture — everything else is file I/O or stdout writes.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { openSync, writeSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ThemeEntry } from "./types.js";

/** RGB snapshot for cancel/restore. */
export interface ItermThemeSnapshot {
	[key: string]: { r: number; g: number; b: number };
}

// --- /dev/tty for escape sequences ---

let _ttyFd: number | null = null;

function getTtyFd(): number {
	if (_ttyFd === null) _ttyFd = openSync("/dev/tty", "w");
	return _ttyFd;
}

function hexToOsc(hex: string): string {
	const n = hex.replace("#", "");
	return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4, 6)}`;
}

// --- Escape sequence preview (synchronous, 0ms) ---

/**
 * Apply a theme to the terminal via OSC escape sequences.
 * Writes to /dev/tty — bypasses Pi's TUI entirely.
 * Completely synchronous, ~0.05ms.
 */
export function applyThemeToItermSync(theme: ThemeEntry): void {
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
 * Restore terminal colors from a snapshot via escape sequences.
 * Synchronous, ~0.05ms.
 */
export function restoreSnapshotSync(snapshot: ItermThemeSnapshot): void {
	const fd = getTtyFd();
	const seqs: string[] = [];
	const v = snapshot;
	const rgb2osc = (c: { r: number; g: number; b: number }) =>
		`${c.r.toString(16).padStart(2, "0")}/${c.g.toString(16).padStart(2, "0")}/${c.b.toString(16).padStart(2, "0")}`;
	if (v["Background Color"]) seqs.push(`\x1b]11;rgb:${rgb2osc(v["Background Color"])}\x07`);
	if (v["Foreground Color"]) seqs.push(`\x1b]10;rgb:${rgb2osc(v["Foreground Color"])}\x07`);
	if (v["Cursor Color"]) seqs.push(`\x1b]12;rgb:${rgb2osc(v["Cursor Color"])}\x07`);
	for (let i = 0; i < 16; i++) {
		const c = v[`Ansi ${i} Color`];
		if (c) seqs.push(`\x1b]4;${i};rgb:${rgb2osc(c)}\x07`);
	}
	writeSync(fd, seqs.join(""));
}

// --- Plist persistence (~26ms, non-blocking) ---

const PLIST_PATH = join(homedir(), "Library", "Preferences", "com.googlecode.iterm2.plist");

function hexToColorDict(hex: string): Record<string, number | string> {
	const n = hex.replace("#", "");
	return {
		"Red Component": parseInt(n.slice(0, 2), 16) / 255,
		"Green Component": parseInt(n.slice(2, 4), 16) / 255,
		"Blue Component": parseInt(n.slice(4, 6), 16) / 255,
		"Alpha Component": 1.0,
		"Color Space": "sRGB",
	};
}

/**
 * Persist theme colors to the iTerm2 profile on disk.
 * Writes directly to the preferences plist — no API, no bridge.
 * New tabs/windows will pick up the colors. ~26ms.
 *
 * Fire-and-forget: runs in a detached child process so it never blocks.
 */
export function persistThemeToProfile(theme: ThemeEntry): void {
	const profileName = process.env.ITERM_PROFILE || "Default";
	const colors: Record<string, string> = {};
	colors["Background Color"] = theme.colors.background;
	colors["Foreground Color"] = theme.colors.foreground;
	if (theme.cursor) colors["Cursor Color"] = theme.cursor;
	if (theme.cursorText) colors["Cursor Text Color"] = theme.cursorText;
	if (theme.selectionBackground) colors["Selection Color"] = theme.selectionBackground;
	if (theme.selectionForeground) colors["Selected Text Color"] = theme.selectionForeground;
	for (let i = 0; i < 16; i++) {
		const hex = theme.colors.palette[i];
		if (hex) colors[`Ansi ${i} Color`] = hex;
	}

	// Fire-and-forget python one-liner that writes the plist
	const script = `
import plistlib,json,sys
d=json.loads(sys.argv[1])
p=sys.argv[2]
n=sys.argv[3]
with open(p,"rb") as f: prefs=plistlib.load(f)
bk=prefs.get("New Bookmarks",[])
idx=next((i for i,b in enumerate(bk) if b.get("Name")==n),None)
if idx is None: sys.exit(0)
for k,h in d.items():
 h=h.lstrip("#")
 bk[idx][k]={"Red Component":int(h[0:2],16)/255,"Green Component":int(h[2:4],16)/255,"Blue Component":int(h[4:6],16)/255,"Alpha Component":1.0,"Color Space":"sRGB"}
with open(p,"wb") as f: plistlib.dump(prefs,f)
`;
	const child = spawn("python3", ["-c", script, JSON.stringify(colors), PLIST_PATH, profileName], {
		stdio: "ignore",
		detached: true,
	});
	child.unref();
}

// --- Bridge for snapshot only ---

let _bridge: ChildProcess | null = null;
let _bridgeRl: ReadlineInterface | null = null;
let _ready = false;
let _pendingReads: Array<(data: any) => void> = [];

function bridgePath(): string {
	return join(__dirname, "iterm2-bridge.py");
}

/** Start the bridge process. Call once at session_start. */
export async function initItermConnection(): Promise<void> {
	if (_bridge && !_bridge.killed) return;
	try {
		_bridge = spawn("python3", [bridgePath()], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
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
		const readyMsg = await new Promise<any>((resolve) => _pendingReads.push(resolve));
		_ready = readyMsg?.ready === true;
	} catch {
		_ready = false;
		_bridge = null;
	}
}

export function isItermReady(): boolean {
	return _ready && _bridge !== null && !_bridge.killed;
}

export function disconnectIterm(): void {
	if (_bridge && !_bridge.killed) {
		_bridge.stdin?.write(JSON.stringify({ cmd: "quit" }) + "\n");
		_bridge.kill();
	}
	_bridge = null;
	_bridgeRl = null;
	_ready = false;
}

process.on("exit", () => { if (_bridge && !_bridge.killed) _bridge.kill(); });

/**
 * Capture current session colors via the bridge. ~14ms.
 * Only used once at picker open.
 */
export async function captureItermSnapshot(): Promise<ItermThemeSnapshot | null> {
	if (!isItermReady()) return null;
	_bridge!.stdin!.write(JSON.stringify({ cmd: "snapshot" }) + "\n");
	const response = await new Promise<any>((resolve) => _pendingReads.push(resolve));
	if (response?.ok && response.snapshot) return response.snapshot;
	return null;
}

// --- Compat exports ---

export function hexToItermColor(hex: string) {
	return hexToColorDict(hex);
}
