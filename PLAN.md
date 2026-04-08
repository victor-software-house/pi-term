# pi-term execution plan

## Objective

Convert this hard fork of `pi-cmux-theme-picker` into `pi-term`: an iTerm2-first Pi extension that uses an embedded theme catalog and live theme mutation through `@shadr/iterm2-ts`.

This document is intentionally detailed enough to drive multiple uninterrupted implementation sessions without re-planning in chat.

## Current grounded state

### Repo status

- Package metadata has already been renamed to `pi-term`.
- `README.md` and `AGENTS.md` already describe the fork direction.
- The code is still almost entirely cmux-shaped.

### Existing files of interest

```text
extensions/
  cmux.ts
  colors.ts
  index.ts
  pi-theme.ts
  picker.ts
  settings.ts
  types.ts
```

### Confirmed technical facts

1. iTerm2 live color mutation works immediately.
2. `@shadr/iterm2-ts` can be loaded from Node/TS and used successfully.
3. Applying a fully embedded theme to the active iTerm2 session works.
4. The current picker architecture is worth preserving:
   - zero heavy work in `handleInput`
   - trailing-only debounce for preview
   - explicit cancel/confirm flow
5. The current Pi theme generation code is reusable, but its naming and file cleanup logic are cmux-coupled.

## Non-goals for the first migration pass

Do not do these in the first pass unless they become necessary:

- multi-terminal abstraction beyond iTerm2
- preset-based iTerm2 integration
- startup theme autodetection from iTerm2 preset matching
- importing the full theme catalog before one embedded theme works end-to-end
- large UX redesign of the picker
- test suite buildout before the basic migration runs manually end-to-end

## Migration strategy

### Guiding principles

1. Preserve working UX where possible.
2. Remove cmux coupling in visible layers early.
3. Introduce iTerm2 integration behind explicit adapter-style boundaries.
4. Move theme source-of-truth from terminal-bundled files to embedded repo data.
5. Land the migration in small reviewable commits.

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

1. Replace user-facing mentions of:
   - `cmux`
   - `ghostty`
   - `pi-cmux-theme-picker`
2. Rename status keys and transient internal labels:
   - `cmux-theme` → `term-theme` or `terminal-theme`
   - `cmux-preview-*` → `term-preview-*`
   - `cmux-sync-*` → `term-sync-*`
   - `cmux-restore-*` → `term-restore-*`
3. Rename comments so they describe terminal themes generically or iTerm2 specifically.
4. Rename settings filename:
   - `pi-cmux-theme-picker.json` → `pi-term.json`
5. Update type names where they are purely branding artifacts:
   - `CmuxColors` → likely `TerminalThemeColors`
   - `CmuxThemeEntry` → likely `ThemeEntry`

### Acceptance criteria

- Grep for `pi-cmux-theme-picker` returns only historical docs or intentional compatibility notes.
- Grep for `cmux-preview`, `cmux-sync`, `cmux-theme` returns zero or only explicitly quarantined legacy code.
- The code reads like an active migration rather than a renamed cmux package.

### Suggested commit

- `refactor: rename cmux-era theme concepts to pi-term terminology`

---

## Phase 2 — introduce embedded theme model

### Goal

Define the new source of truth for themes without yet replacing all runtime behavior.

### New files to add

- `extensions/themes.ts`
- optionally `extensions/theme-catalog/` if the data grows quickly

### Theme model shape

Use a minimal first-pass structure:

```ts
export interface EmbeddedTheme {
  name: string;
  isDark: boolean;
  colors: {
    background: string;
    foreground: string;
    cursor?: string;
    cursorText?: string;
    selectionBackground?: string;
    selectionForeground?: string;
    palette: Record<number, string>;
  };
}
```

### Initial content

Add exactly one fully embedded theme first:

- `Tomorrow Night Burns`

### Helper API to expose

- `getEmbeddedThemes(): EmbeddedTheme[]`
- `getEmbeddedThemeByName(name: string): EmbeddedTheme | undefined`

### Acceptance criteria

- Theme lookup no longer depends on `/Applications/cmux.app/...`.
- One embedded theme can be imported and used from any module.

### Suggested commit

- `feat: add embedded theme catalog with tomorrow night burns`

---

## Phase 3 — add iTerm2 adapter

### Goal

Create a small, explicit integration layer for iTerm2 live theme operations.

### New file to add

- `extensions/iterm2.ts`

### Responsibilities

The adapter should own:

1. connection lifecycle to `@shadr/iterm2-ts`
2. finding the active session
3. reading current theme-related profile properties
4. applying an embedded theme to the current session
5. restoring a previously captured snapshot

### Avoid in this phase

- broad abstraction for future terminals
- hidden singleton magic across the codebase

### Proposed API

```ts
export interface ItermColorValue {
  "Red Component": number;
  "Green Component": number;
  "Blue Component": number;
  "Alpha Component": number;
  "Color Space": "sRGB" | string;
}

export interface ItermThemeSnapshot {
  sessionId: string;
  values: Record<string, unknown>;
}

export async function getActiveItermSessionId(): Promise<string | null>
export async function captureItermThemeSnapshot(sessionId?: string): Promise<ItermThemeSnapshot | null>
export async function applyEmbeddedThemeToIterm(theme: EmbeddedTheme, sessionId?: string): Promise<string>
export async function restoreItermThemeSnapshot(snapshot: ItermThemeSnapshot): Promise<void>
```

### Properties to capture and apply

At minimum:

- `Background Color`
- `Foreground Color`
- `Cursor Color`
- `Cursor Text Color`
- `Selection Color`
- `Selected Text Color`
- `Ansi 0 Color` … `Ansi 15 Color`

### Helper functions needed

- `hexToItermColor(hex)`
- `buildItermAssignments(theme)`
- optional `withItermConnection(fn)` wrapper

### Acceptance criteria

- A standalone script path inside the extension can:
  - capture current colors
  - apply `Tomorrow Night Burns`
  - restore the exact prior snapshot
- No cmux CLI calls are involved.

### Suggested commit

- `feat: add iterm2 theme adapter using iterm2-ts`

---

## Phase 4 — decouple picker from cmux

### Goal

Keep the current picker UX but replace its backend behavior.

### Files to touch

- `extensions/picker.ts`
- `extensions/types.ts`

### Required changes

1. Replace imports from `cmux.ts` with imports from:
   - `themes.ts`
   - `iterm2.ts`
2. Replace current theme list source:
   - `getAvailableCmuxThemes()` → `getEmbeddedThemes()`
3. Replace original-theme restore logic:
   - stop relying on current theme name from cmux
   - use an iTerm2 snapshot captured before preview starts
4. Replace preview behavior:
   - build Pi theme instance from embedded theme colors
   - call `applyEmbeddedThemeToIterm()` in the debounced preview
5. Replace confirm behavior:
   - write and set Pi theme from embedded theme colors
   - keep iTerm2 theme as already applied
6. Replace cancel behavior:
   - restore Pi theme instance from captured original colors if available
   - restore iTerm2 snapshot exactly

### Important behavior contract

`handleInput` still must do no heavy work.

Heavy work remains in the trailing debounce and close handlers.

### Acceptance criteria

- `/theme` preview updates Pi + iTerm2 live.
- `Esc` restores both Pi + iTerm2.
- `Enter` confirms both Pi + iTerm2.
- Picker no longer imports `cmux.ts`.

### Suggested commit

- `feat: drive theme picker from embedded themes and iterm2`

---

## Phase 5 — refactor Pi theme generation away from cmux naming

### Goal

Preserve the good Pi theme generation logic while removing old naming assumptions.

### Files to touch

- `extensions/pi-theme.ts`
- `extensions/types.ts`

### Required changes

1. Rename types and comments so they no longer refer to cmux.
2. Rename generated Pi theme file cleanup rules:
   - keep deleting old `cmux-sync-*` and `ghostty-sync-*` during a transition period if useful
   - but write new files as `term-sync-*`
3. Ensure helper functions accept the new embedded theme color type cleanly.
4. Check whether any logic assumes theme discovery from files and remove that assumption.

### Migration compatibility note

Transitional cleanup can remove legacy generated theme files from old package names so the user’s theme directory does not accumulate junk.

### Acceptance criteria

- Pi theme JSON generation works from embedded theme colors.
- Newly written theme files use `term-sync-*` naming.
- Cleanup removes old legacy artifacts safely.

### Suggested commit

- `refactor: rename pi theme generation artifacts for pi-term`

---

## Phase 6 — replace command-level cmux logic in index.ts

### Goal

Remove cmux as the extension’s behavioral control plane.

### Files to touch

- `extensions/index.ts`

### Required changes

1. Remove imports from `cmux.ts`.
2. Replace command description text.
3. Replace direct apply path (`/theme "Theme Name"`) so it:
   - looks up embedded theme
   - applies iTerm2 theme directly
   - writes and sets matching Pi theme
4. Decide how session-start sync behaves initially.

### Recommended initial decision

For the first pass, disable or simplify auto-sync rather than attempting smart iTerm2 preset detection.

Two safe options:

- Option A: only sync on explicit `/theme` actions
- Option B: keep startup sync off by default and document it as future work

### Avoid right now

- expensive preset matching across all iTerm2 presets at session start
- hidden startup behavior that mutates the terminal unexpectedly

### Acceptance criteria

- `index.ts` contains no operational cmux dependency.
- `/theme` direct apply works for embedded themes.
- startup behavior is explicit and documented.

### Suggested commit

- `refactor: remove cmux command integration from extension entrypoint`

---

## Phase 7 — settings migration cleanup

### Goal

Stabilize persistence after the functional migration works.

### Files to touch

- `extensions/settings.ts`
- `README.md`
- `AGENTS.md`

### Required changes

1. Rename settings file paths to `pi-term.json`.
2. Optionally support one-time migration read from the legacy filename.
3. Remove settings that only make sense for cmux-autosync if they no longer apply.
4. Keep preview debounce and Pi theme generation params.

### Recommended migration behavior

- Read new path first.
- If missing, read legacy path.
- On first write, write to new path only.

### Acceptance criteria

- Fresh installs use `pi-term.json`.
- Existing users do not lose settings unexpectedly.

### Suggested commit

- `refactor: migrate settings persistence to pi-term paths`

---

## Phase 8 — quarantine or delete legacy cmux code

### Goal

Remove ambiguity once iTerm2 flow is stable.

### Files to remove or quarantine

- `extensions/cmux.ts`

### Recommended approach

Preferred:
- delete `extensions/cmux.ts` once no code depends on it

Alternative:
- move to `extensions/legacy/cmux.ts` only if historical reference is truly valuable

### Acceptance criteria

- there is no active runtime dependency on cmux
- grep for `cmux` in runtime code returns zero or intentional compatibility comments only

### Suggested commit

- `refactor: remove legacy cmux integration`

---

## Phase 9 — expand theme catalog

### Goal

Scale from one embedded theme to the real catalog.

### Options

#### Option A — generated TS/JSON artifact in repo

Pros:
- deterministic runtime
- simple lookup
- no shelling out at runtime

Cons:
- bigger repo payload

#### Option B — checked-in source + generation script

Pros:
- clean source of truth
- easier regeneration

Cons:
- two-layer mental model

### Recommendation

Use both:

- source generation script or source file under `scripts/` or `tools/`
- checked-in generated artifact under `extensions/themes.generated.ts`

### Acceptance criteria

- all intended themes are available from the picker
- no runtime dependency on cmux/Ghostty bundles

### Suggested commit

- `feat: embed full theme catalog`

---

## Phase 10 — verification and release prep

### Manual verification checklist

1. `bun run typecheck`
2. open `/theme`
3. preview `Tomorrow Night Burns`
4. verify iTerm2 changes instantly
5. verify Pi theme changes instantly
6. press `Esc`
7. verify exact restore in both Pi and iTerm2
8. reopen picker
9. press `Enter` on a theme
10. verify confirmed theme persists in Pi and stays applied in iTerm2
11. test direct apply:
    - `/theme "Tomorrow Night Burns"`
12. test settings persistence if settings were migrated

### Code grep checklist

Run and drive toward near-zero:

- `grep -R "cmux" extensions`
- `grep -R "ghostty" extensions`
- `grep -R "pi-cmux-theme-picker" .`

### Release prep checklist

1. ensure package metadata is final
2. ensure README matches actual behavior
3. add changeset when releasable work is ready
4. verify both lockfiles stay in sync if dependencies changed

## Detailed file-by-file action list

### `extensions/types.ts`

- rename cmux-specific exported types
- add embedded theme interfaces
- add iTerm2 snapshot type if needed

### `extensions/colors.ts`

- likely reusable unchanged
- only touch if naming/comments mention cmux

### `extensions/pi-theme.ts`

- rename artifact prefixes
- switch comments and type references away from cmux
- accept embedded theme color input shape

### `extensions/settings.ts`

- rename settings filename
- optionally support legacy path migration
- update comments

### `extensions/picker.ts`

- remove cmux imports
- use embedded themes
- use iTerm2 snapshot/apply/restore
- keep debounce architecture intact

### `extensions/index.ts`

- rewrite command descriptions
- remove session-start cmux sync behavior
- use embedded themes for named apply
- update status key and notification copy

### `extensions/cmux.ts`

- delete after migration stabilizes

### `extensions/themes.ts`

- new embedded theme catalog entrypoint

### `extensions/iterm2.ts`

- new iTerm2 live theme adapter

## Suggested commit sequence

1. `refactor: rename cmux-era theme concepts to pi-term terminology`
2. `feat: add embedded theme catalog with tomorrow night burns`
3. `feat: add iterm2 theme adapter using iterm2-ts`
4. `feat: drive theme picker from embedded themes and iterm2`
5. `refactor: rename pi theme generation artifacts for pi-term`
6. `refactor: remove cmux command integration from extension entrypoint`
7. `refactor: migrate settings persistence to pi-term paths`
8. `refactor: remove legacy cmux integration`
9. `feat: embed full theme catalog`
10. `docs: update README for iTerm2 embedded theme workflow`

## Known risks and mitigations

### Risk: partial restore leaves terminal mismatched

Mitigation:
- always capture full snapshot before preview starts
- restore exact captured values, not guessed presets

### Risk: iTerm2 connection/auth edge cases

Mitigation:
- keep connection wrapper isolated in `iterm2.ts`
- surface actionable errors in notifications

### Risk: startup sync becomes surprising or destructive

Mitigation:
- defer smart startup sync until explicit behavior is chosen
- default to explicit `/theme` actions first

### Risk: full theme import is noisy and hard to review

Mitigation:
- first land one-theme end-to-end path
- import full catalog in a separate commit

## Immediate next action

Begin Phase 1 and Phase 2 together:

1. rename runtime terminology in `extensions/`
2. add `extensions/themes.ts` with `Tomorrow Night Burns`
3. do not stop to re-plan unless runtime findings contradict this document
