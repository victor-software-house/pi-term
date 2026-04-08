# pi-term migration plan

## Goal

Hard-fork `pi-cmux-theme-picker` into `pi-term` and rebuild it as an iTerm2-first Pi extension with embedded themes and live theme preview via `@shadr/iterm2-ts`.

## Confirmed facts

- iTerm2 live theme mutation works immediately through `@shadr/iterm2-ts`.
- Embedded theme application works with a single test theme (`Tomorrow Night Burns`).
- The current repo is heavily cmux-shaped in naming, docs, file layout, and assumptions.
- A clean fork is lower-risk than trying to preserve cmux compatibility in-place.

## Phase 1 — fork cleanup and rename

1. Rename package identity from `pi-cmux-theme-picker` to `pi-term`.
2. Update `README.md`, `AGENTS.md`, package metadata, keywords, preview copy, and repository URLs.
3. Rename cmux-specific status keys, file prefixes, and user-facing strings.
4. Remove or quarantine cmux-only implementation files.

## Phase 2 — define terminal abstraction

1. Introduce a terminal adapter boundary focused on actual needs:
   - get active target
   - capture current theme colors
   - apply embedded theme live
   - restore prior colors
2. Implement the first adapter for iTerm2 only.
3. Avoid speculative multi-terminal support until the iTerm2 path is stable.

## Phase 3 — embed themes

1. Create a theme definition format in TypeScript/JSON.
2. Start with one embedded theme (`Tomorrow Night Burns`) as the first end-to-end reference.
3. Add import tooling or generated assets for the full theme catalog once the shape is stable.
4. Keep theme data separate from adapter logic.

## Phase 4 — integrate iTerm2 live preview

1. Replace cmux preview/apply calls with iTerm2 SDK calls.
2. Capture original session colors before preview starts.
3. Apply background, foreground, cursor, selection, and ANSI 0-15 colors on preview.
4. Restore exact captured colors on cancel.
5. Confirm behavior on apply and on resume/reload paths.

## Phase 5 — keep Pi theme sync

1. Preserve the existing Pi theme generation pipeline where useful.
2. Feed it from embedded theme definitions rather than cmux theme files.
3. Revisit naming for generated Pi theme artifacts to remove cmux coupling.

## Phase 6 — settings and UX cleanup

1. Remove cmux-specific settings and terminology.
2. Keep the good picker UX and debounce architecture.
3. Decide whether startup sync should follow the active iTerm2 session theme or only explicit `/theme` actions.

## Phase 7 — verification

1. Typecheck with `bun run typecheck`.
2. Verify live preview in iTerm2.
3. Verify cancel restores original colors exactly.
4. Verify Pi theme update and persistence still work.

## Recommended first implementation slice

1. Rename package and docs.
2. Add `iterm2.ts` adapter.
3. Add embedded `Tomorrow Night Burns` theme.
4. Wire preview/apply/cancel through iTerm2.
5. Validate end-to-end before importing the full theme set.

## Open decisions

1. Package name: keep `pi-term` or use `pi-iterm-theme-picker` for npm clarity.
2. Whether `pi-term` should be iTerm2-only initially in docs and metadata.
3. Whether to preserve the current `/theme-settings` surface exactly or simplify it during the fork.
