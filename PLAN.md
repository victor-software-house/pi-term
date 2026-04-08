# pi-term execution plan

## Status: COMPLETE

All phases landed on `feat/iterm2-migration`. The extension is functionally complete.

Remaining work before merging to `main`:
- Manual smoke test (run `/theme` in an active Pi session against iTerm2)
- Add changeset for the release
- Merge via PR

---

## Objective

Convert the hard fork of `pi-cmux-theme-picker` into `pi-term`: an iTerm2-first Pi extension using an embedded theme catalog and live theme mutation through `@shadr/iterm2-ts`.

---

## Validated technical facts

### Sequential property apply is too slow

22 sequential `setProfileProperty` calls: ~2350ms. Unusable for live preview.

### Parallel apply via Promise.all is fast enough

22 parallel `setProfileProperty` calls: ~260-300ms. Viable for debounced preview.

**Rule: always use `Promise.all` for iTerm2 color apply and restore.**

### Full round-trip works with zero mismatches

Capture → apply different theme → restore → verify: zero mismatches. Snapshot/restore is reliable.

### Connection cost

- First connect / reconnect (warm cookie): ~280-300ms
- Strategy: connect once when picker opens, disconnect on confirm or cancel.

### Extension dependency resolution

Pi extensions resolve from their own `node_modules/`. `@shadr/iterm2-ts` is a proper `package.json` dependency.

### Embedded theme shape matches Pi generation input

`TerminalColors = { background, foreground, palette: Record<number,string> }` — structurally identical to the old `CmuxColors`. Optional `cursor`, `cursorText`, `selectionBackground`, `selectionForeground` fields are additive.

### iTerm2 color property format

```json
{ "Red Component": 0.08, "Green Component": 0.08, "Blue Component": 0.08, "Alpha Component": 1, "Color Space": "sRGB" }
```

Hex → float via `parseInt(hex, 16) / 255`. Colors are applied per-session via `setProfileProperty`.

---

## Architecture

```
extensions/
  index.ts      — session_start hook · /theme · /theme-settings · status · autocomplete
  picker.ts     — TUI inline picker (trailing debounce, zero work in handleInput)
  pi-theme.ts   — Pi theme JSON generation · writeAndSetPiTheme · buildThemeInstance
  iterm2.ts     — iTerm2 adapter (connection · captureSnapshot · applyTheme · restoreSnapshot)
  themes.ts     — embedded catalog (463 themes from Ghostty bundle)
  colors.ts     — pure color math (unchanged)
  settings.ts   — disk-persisted settings (~/.pi/agent/extensions/pi-term.json)
  types.ts      — shared interfaces (TerminalColors · ThemeEntry · FilterMode · etc.)
```

### Key invariants

- `handleInput` does zero heavy work — state update + `requestRender()` only
- Preview runs in trailing-only debounce (`perfect-debounce`, `previewDebounceMs`)
- iTerm2 connection is persistent for picker lifetime
- All multi-property operations use `Promise.all`
- Cancel restores via per-session snapshot, not named presets
- Confirm writes a `term-sync-{slug}.json` file and applies via `setTheme`
- Artifact prefix: `term-preview-*` (ephemeral), `term-sync-*` (confirmed)

---

## Phase log

| Phase | Description | Commits |
|:------|:------------|:--------|
| 0 | Hard fork, metadata rename, dependency install | `main` |
| 1 | Rename `CmuxColors` → `TerminalColors`, `CmuxThemeEntry` → `ThemeEntry` | `2230f1e` |
| 2 | `themes.ts` — one seed theme (Tomorrow Night Burns) | `59ad16e` |
| 3 | `iterm2.ts` — adapter with `Promise.all` | `3dde525` |
| 4 | Picker and index rewired to embedded themes + iTerm2 | `6df3287` |
| 5 | `pi-theme.ts` prefix → `term-sync-*` | inline with Phase 1–4 |
| 6 | `index.ts` cmux removal | inline with Phase 4 |
| 7 | Settings path → `pi-term.json`, `autoSync` removed | inline |
| 8 | `cmux.ts` deleted | `5b8aa39` |
| 9 | Full 463-theme catalog embedded | `c0c29f3` |
| 10 | README rewrite, PLAN finalized | this commit |

---

## Smoke test checklist

Before merging:

1. `bun run typecheck` passes ✔
2. Load extension in Pi against an active iTerm2 session
3. `/theme` opens picker; arrow keys navigate without lag
4. Preview applies to both iTerm2 and Pi UI
5. `esc` restores original terminal and Pi colors exactly
6. `enter` confirms; theme persists across Pi restart
7. `/theme "Dracula"` applies without opening picker
8. `/theme-settings` opens settings panel; adjusting weights updates Pi UI live
