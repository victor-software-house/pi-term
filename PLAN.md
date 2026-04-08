# pi-term execution plan

## Objective

Convert this hard fork of `pi-cmux-theme-picker` into `pi-term`: an iTerm2-first Pi extension that uses an embedded theme catalog and live theme mutation through `@shadr/iterm2-ts`.

This document is intentionally detailed enough to drive multiple uninterrupted implementation sessions without re-planning in chat.

## Current grounded state

### Repo status

- Package metadata renamed to `pi-term`.
- `README.md` and `AGENTS.md` describe the fork direction.
- `@shadr/iterm2-ts` added as a dependency and installed.
- Both lockfiles synced (`bun.lock`, `pnpm-lock.yaml`).
- The extension code is still almost entirely cmux-shaped.

### Existing files of interest

```text
extensions/
  cmux.ts       — legacy, to be removed
  colors.ts     — pure color math, reusable as-is
  index.ts      — main entrypoint, heavily cmux-coupled
  pi-theme.ts   — Pi theme generation, reusable with renames
  picker.ts     — TUI picker, reusable with backend swap
  settings.ts   — persistence, needs path rename
  types.ts      — shared types, needs type renames
```

## Validated technical facts

These were confirmed by live experiments, not assumptions:

### 1. Sequential property apply is too slow

22 sequential `setProfileProperty` calls: **~2350ms**.
This is unusable for live preview with 200ms debounce.

### 2. Parallel apply via `Promise.all` is fast enough

22 parallel `setProfileProperty` calls: **~260-300ms**.
This is viable for debounced preview. The debounce cooldown absorbs the apply time.

**Critical implementation rule: always use `Promise.all` for iTerm2 color apply and restore.**

### 3. Full round-trip works with zero mismatches

Capture → apply different theme → restore → verify: **zero mismatches**.
The snapshot/restore path is reliable.

### 4. Connection speed

- First connect: ~300ms
- Reconnect (warm cookie): ~280ms

Implication: a persistent connection during picker use is strongly preferred over connect-per-preview. Connect once when picker opens, disconnect on close.

### 5. Extension dependency resolution

Pi extensions resolve dependencies from their own `node_modules/`.
`@shadr/iterm2-ts` is now installed as a proper dependency and will resolve correctly at extension load time.

### 6. Embedded theme color shape is compatible with Pi theme generation

`CmuxColors` = `{ background: string, foreground: string, palette: Record<number, string> }`.
The planned `EmbeddedTheme.colors` has exactly the same shape plus optional cursor/selection fields.
Pi theme generation can consume embedded themes with no structural changes — only renames.

### 7. iTerm2 color property format

Values are JSON objects with 0-1 float components:
```json
{
  "Red Component": 0.08,
  "Green Component": 0.08,
  "Blue Component": 0.08,
  "Alpha Component": 1,
  "Color Space": "sRGB"
}
```

Property keys use title case with spaces:
- `Background Color`, `Foreground Color`, `Cursor Color`, `Cursor Text Color`
- `Selection Color`, `Selected Text Color`
- `Ansi 0 Color` … `Ansi 15 Color`

### 8. The TS SDK does not expose batch/preset APIs

`@shadr/iterm2-ts` wraps each call as a single protobuf request. The underlying protobuf schema supports `assignments` (batch), but the SDK does not expose it. However, `Promise.all` over the existing single-property API is fast enough, so this is not a blocker.

## Non-goals for the first migration pass

- multi-terminal abstraction beyond iTerm2
- preset-based iTerm2 integration
- startup theme autodetection from iTerm2 preset matching
- importing the full theme catalog before one embedded theme works end-to-end
- large UX redesign of the picker
- test suite buildout before the basic migration runs manually end-to-end

## Detailed phase plan

---

## Phase 1 — terminology and file responsibility cleanup

### Goal

Make the codebase readable as `pi-term` before changing deeper behavior.

### Files to touch

- `extensions/index.ts`
- `extensions/picker.ts`
- `extensions/pi-theme.ts`
- `extensions/settings.ts`
- `extensions/types.ts`

### Required changes

1. Replace user-facing mentions of `cmux`, `ghostty`, `pi-cmux-theme-picker`.
2. Rename status keys and transient labels:
   - `cmux-theme` → `terminal-theme`
   - `cmux-preview-*` → `term-preview-*`
   - `cmux-sync-*` → `term-sync-*`
   - `cmux-restore-*` → `term-restore-*`
3. Rename settings filename: `pi-cmux-theme-picker.json` → `pi-term.json`
4. Rename types:
   - `CmuxColors` → `TerminalColors`
   - `CmuxThemeEntry` → `ThemeEntry`
5. Update all comments.

### Acceptance criteria

- Grep for `cmux` in `extensions/*.ts` returns zero outside of `cmux.ts` itself.
- Grep for `pi-cmux-theme-picker` returns zero outside historical docs.

### Suggested commit

- `refactor: rename cmux-era concepts to pi-term terminology`

---

## Phase 2 — add embedded theme model

### Goal

Define the new theme source of truth.

### New file

- `extensions/themes.ts`

### Theme shape

```ts
export interface EmbeddedTheme {
  name: string;
  isDark: boolean;
  colors: TerminalColors;    // { background, foreground, palette }
  cursor?: string;
  cursorText?: string;
  selectionBackground?: string;
  selectionForeground?: string;
}
```

This reuses `TerminalColors` (renamed from `CmuxColors`) directly, so Pi theme generation works without adapter code.

### Initial content

One theme: `Tomorrow Night Burns`.

### Exported API

- `getEmbeddedThemes(): EmbeddedTheme[]`
- `getEmbeddedThemeByName(name: string): EmbeddedTheme | undefined`

### Suggested commit

- `feat: add embedded theme catalog with Tomorrow Night Burns`

---

## Phase 3 — add iTerm2 adapter

### Goal

Isolated iTerm2 integration layer.

### New file

- `extensions/iterm2.ts`

### Design constraints from experiments

1. **Use `Promise.all` for all multi-property operations** — sequential is 10x slower.
2. **Maintain a persistent connection** during picker use — connect once, disconnect on close.
3. **Capture full snapshot before preview starts** — 22 properties, parallel read.

### Connection management

```ts
let connection: ITerm2 | null = null;

export async function ensureConnection(): Promise<ITerm2>
export function disconnectIterm(): void
```

The picker opens → `ensureConnection()`. The picker closes → `disconnectIterm()`.

### Properties to capture/apply

```ts
const ITERM_COLOR_KEYS = [
  'Background Color', 'Foreground Color',
  'Cursor Color', 'Cursor Text Color',
  'Selection Color', 'Selected Text Color',
  ...Array.from({ length: 16 }, (_, i) => `Ansi ${i} Color`),
];
```

### Proposed API

```ts
export interface ItermThemeSnapshot {
  sessionId: string;
  values: Record<string, unknown>;
}

export function hexToItermColor(hex: string): ItermColorValue

export async function getActiveSessionId(): Promise<string | null>
export async function captureSnapshot(sessionId?: string): Promise<ItermThemeSnapshot | null>
export async function applyTheme(theme: EmbeddedTheme, sessionId?: string): Promise<void>
export async function restoreSnapshot(snapshot: ItermThemeSnapshot): Promise<void>
```

### Suggested commit

- `feat: add iterm2 adapter with parallel color apply`

---

## Phase 4 — rewire picker to use embedded themes + iTerm2

### Goal

Replace cmux backend in picker while keeping UX intact.

### Files to touch

- `extensions/picker.ts`

### Required changes

1. Replace `getAvailableCmuxThemes()` → `getEmbeddedThemes()`
2. Replace `getCurrentCmuxThemeName()` → `getActiveSessionId()` + `captureSnapshot()`
3. Replace preview apply:
   - build Pi theme instance from `EmbeddedTheme.colors`
   - call `applyTheme(theme)` (iTerm2, parallel)
4. Replace confirm:
   - `writeAndSetPiTheme()` from embedded colors
   - iTerm2 theme already applied, just disconnect
5. Replace cancel:
   - `restoreSnapshot()` (iTerm2, parallel)
   - restore Pi theme from snapshot-built instance
6. Connection lifecycle:
   - `ensureConnection()` at picker open
   - `disconnectIterm()` at picker close (confirm or cancel)

### `handleInput` contract preserved

No change. Still zero heavy work. Debounce still reads shared state.

### Suggested commit

- `feat: drive picker from embedded themes and iterm2`

---

## Phase 5 — refactor Pi theme generation naming

### Files to touch

- `extensions/pi-theme.ts`
- `extensions/types.ts`

### Changes

1. Rename comments/types away from cmux.
2. Change file prefixes: `cmux-sync-*` → `term-sync-*`.
3. Add transitional cleanup for old `cmux-sync-*` and `ghostty-sync-*` artifacts.
4. Accept `TerminalColors` (same shape, new name).

### Suggested commit

- `refactor: rename pi theme artifacts for pi-term`

---

## Phase 6 — replace cmux logic in index.ts

### Files to touch

- `extensions/index.ts`

### Changes

1. Remove cmux imports.
2. Replace `/theme "Name"` direct-apply to use embedded themes + iTerm2.
3. Replace session-start sync:
   - **For now: disable auto-sync.** Only explicit `/theme` actions apply themes.
   - Document as future work.
4. Update command descriptions and notifications.

### Suggested commit

- `refactor: remove cmux integration from entrypoint`

---

## Phase 7 — settings migration

### Files to touch

- `extensions/settings.ts`

### Changes

1. Rename `CONFIG_FILENAME` to `pi-term.json`.
2. On first read, check legacy path and migrate silently.
3. Remove cmux-specific settings if any exist.

### Suggested commit

- `refactor: migrate settings to pi-term paths`

---

## Phase 8 — delete cmux.ts

### Suggested commit

- `refactor: remove legacy cmux adapter`

---

## Phase 9 — expand theme catalog

### Approach

1. Write a generation script that reads Ghostty theme files and outputs a TS module.
2. Check in the generated artifact as `extensions/theme-data.generated.ts`.
3. `extensions/themes.ts` imports and re-exports it.

### Source for generation

The same Ghostty bundled themes currently at `/Applications/cmux.app/Contents/Resources/ghostty/themes/` or from the `mbadolato/iTerm2-Color-Schemes` repo's ghostty directory.

### Suggested commit

- `feat: embed full theme catalog`

---

## Phase 10 — verification and release prep

### Manual verification checklist

1. `bun run typecheck`
2. `/theme` → picker opens
3. navigate → iTerm2 updates live within debounce window
4. Pi theme updates live
5. `Esc` → both restore exactly
6. reopen → `Enter` → confirmed in both
7. `/theme "Tomorrow Night Burns"` → direct apply works
8. settings persist across reload

### Grep checklist

- `grep -R "cmux" extensions/` → zero (cmux.ts deleted)
- `grep -R "ghostty" extensions/` → zero or generation script only
- `grep -R "pi-cmux-theme-picker" .` → zero

## Suggested commit sequence

1. `refactor: rename cmux-era concepts to pi-term terminology`
2. `feat: add embedded theme catalog with Tomorrow Night Burns`
3. `feat: add iterm2 adapter with parallel color apply`
4. `feat: drive picker from embedded themes and iterm2`
5. `refactor: rename pi theme artifacts for pi-term`
6. `refactor: remove cmux integration from entrypoint`
7. `refactor: migrate settings to pi-term paths`
8. `refactor: remove legacy cmux adapter`
9. `feat: embed full theme catalog`
10. `docs: update README for iTerm2 embedded theme workflow`

## Known risks and mitigations

### Risk: parallel apply causes visual flicker (properties land out of order)

Observed behavior: iTerm2 applies properties as they arrive. With `Promise.all`, bg might change before fg, causing a brief flash.

Mitigation:
- The debounce window (200ms default) means this only happens once per selection, not per keystroke.
- In practice during testing the flash was not noticeable.
- If it becomes a problem, could apply bg+fg first, then ANSI palette.

### Risk: connection drops mid-preview

Mitigation:
- `ensureConnection()` reconnects if needed.
- If reconnection fails, notify user and degrade gracefully (Pi-only preview).

### Risk: `@shadr/iterm2-ts` auth dialog pops up

The SDK uses `osascript` to request an auth cookie from iTerm2. On first use, iTerm2 may show a permission dialog.

Mitigation:
- Document the one-time permission requirement.
- The SDK caches credentials after first approval.

### Risk: startup sync becomes surprising

Mitigation:
- Disabled by default in the first pass.
- Only explicit `/theme` actions change the terminal.

### Risk: full theme import is noisy

Mitigation:
- Land one-theme end-to-end first.
- Import full catalog in a separate commit with generated code.

## Immediate next action

Begin Phase 1 and Phase 2 together:

1. Rename runtime terminology in `extensions/`.
2. Add `extensions/themes.ts` with `Tomorrow Night Burns`.
3. Do not stop to re-plan unless runtime findings contradict this document.
