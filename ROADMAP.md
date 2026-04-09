# Roadmap

Ordered work inventory for `pi-term`.
Detailed decision records and implementation notes live in [`docs/decisions/`](docs/decisions/).

## Next

- [x] **Migrate to changesets** — replaced semantic-release with `@changesets/cli`. See [DR-01](docs/decisions/DR-01-changesets-migration.md). ✔
- [x] ~~**Force-bump rules**~~ — superseded by changesets (explicit changeset files replace commit-type rules). See [DR-02](docs/decisions/DR-02-force-bump-rules.md).
- [x] **Branch protection** — require PRs to `main`, no direct push for non-admins. Configured via GitHub branch protection. ✔

## UX polish

- [x] **Status bar params summary** — show current theme params when non-default (`17c0f2a`) ✔
- [x] **Reset to defaults** — `r` key in `/theme-settings` resets params (`028dd63`) ✔
- [x] **Settings panel overhaul** — color swatches, palette role mapping, scoped settings (global vs per-theme). See [DR-03](docs/decisions/DR-03-settings-panel-ux.md). ✔
  - [x] Palette source types + resolver (`13b71d7`)
  - [x] Theme generation uses palette mapping (`13b71d7`)
  - [x] Color swatches in settings panel (`13b71d7`)
  - [x] Palette role mapping settings UI (`13b71d7`)
  - [x] Scoped settings model in `settings.ts` (`9b21c1d`)
  - [x] Scope toggle UI in `/theme-settings` (`4d0f69c`) ✔
  - [x] Pass theme slug to all `getThemeParams()` callers (`4d0f69c`) ✔
  - [x] Per-theme visual indicators — `* ` prefix + `(global: X)` description (`194a050`) ✔
- [x] **Dead code cleanup** — removed `writePreviewFile()`, `removePreviewThemeFiles()`, `PREVIEW_THEME_PREFIX`, and `previewNameFor()` (`fd9833d`) ✔

## Future

- [x] **Theme persistence** — store selected theme in settings, reapply on `session_start` (Pi UI + iTerm2 session). (`c8c9b17`) ✔
- [ ] Profile-level persistence — write to iTerm2 profile so new tabs also get the theme
- [ ] Theme export: `/theme export` to copy current theme JSON to clipboard
- [ ] Theme import: `/theme import <path>` to load a custom theme file
- [ ] Per-project theme profiles: auto-apply different themes per repo via project config
