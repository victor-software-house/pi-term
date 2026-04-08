# pi-term — Agent Guide

Pi extension fork being rebuilt as an iTerm2-first terminal theme picker for Pi.
Published package target: `pi-term`. Source: `extensions/` (TypeScript, Bun, no build step — Pi loads `.ts` directly).

## What matters most

This repo is a hard fork of `pi-cmux-theme-picker` and is currently in migration.
Treat cmux-specific implementation details as legacy unless a task explicitly says otherwise.

The intended direction is:

- embedded theme catalog
- iTerm2 live theme preview and apply
- Pi theme generation retained where it still fits
- no dependency on cmux as the primary terminal integration

This is still a published-package-style repo with changesets-gated releases. Merging to `main` does not publish automatically — only merging the auto-maintained "Version Packages" PR triggers an npm publish. Treat `main` as a release branch.

## Orient quickly

```
extensions/
  index.ts      — session_start hook · /theme · /theme-settings · status bar · autocomplete
  picker.ts     — TUI inline picker (trailing-only debounce, zero work in handleInput)
  pi-theme.ts   — Pi theme JSON generation · writeAndSetPiTheme · in-memory Theme building
  colors.ts     — pure color math (hex/rgb/hsl · contrast · mixing)
  settings.ts   — disk-persisted settings (currently still using legacy package paths until migrated)
  types.ts      — shared interfaces and theme-generation parameters
PLAN.md         — migration plan for the pi-term fork
.changeset/     — changeset config + pending changeset files
lefthook.yml    — commit-msg: commitlint · pre-push: lockfile + typecheck
```

## Verification

Run before every commit:

```bash
bun run typecheck
```

Lefthook enforces commit message format on `git commit` and lockfile sync + typecheck on `git push`. Do not bypass.

## Commit discipline

- Small, logical commits — one change per commit.
- Conventional Commits are mandatory.
- PRs that affect the published package should include a changeset file.
- During migration, prefer clear transitional commits over mixed rename-plus-behavior rewrites.

## Migration guidance

When changing this repo during the fork:

1. rename user-facing cmux concepts first
2. isolate or remove cmux-only files instead of preserving hidden coupling
3. prefer explicit iTerm2-first architecture over speculative multi-terminal abstractions
4. keep embedded theme data separate from terminal adapter logic
5. update [PLAN.md](PLAN.md) if the migration strategy changes materially

## Architecture constraints

### iTerm2 first

The target integration is iTerm2 via live APIs, not cmux. If legacy cmux files still exist, treat them as migration residue.

### Embedded themes

The target source of truth is an embedded theme catalog in the repo, not terminal-bundled theme files discovered at runtime.

### Preview architecture

Keep `handleInput` light:

1. update shared selection state
2. request render
3. let a trailing-only debounce apply live preview

No heavy work during raw key handling.

### Pi API: always use the live theme

`ctx.ui.theme` is a Proxy — always reflects the current global theme, not a snapshot.

**DO:** `const t = () => ctx.ui.theme`
**DO NOT:** `const originalTheme = ctx.ui.theme`

For cancel/restore, build a fresh Theme instance from captured source colors.

### Settings persistence

Settings are currently transitional. If you touch settings paths, migrate them deliberately and update docs in the same change.

### Dependencies

- `perfect-debounce` — trailing-only debounce
- `@shadr/iterm2-ts` — expected iTerm2 integration target for live theme mutation
- keep `pnpm-lock.yaml` and `bun.lock` in sync

## Documentation

`README.md` is the human entry point. This file is agent-operational guidance. Keep both aligned as the fork migration lands.
