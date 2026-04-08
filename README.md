# pi-term

Live terminal theme picker for [Pi](https://pi.dev), currently being rebuilt around iTerm2 with embedded themes and debounced preview.

![pi-term preview](assets/preview.png)

## Status

This repository is a hard fork of `pi-cmux-theme-picker`.

The new direction is:

- iTerm2-first
- embedded theme catalog
- live preview through iTerm2 APIs
- Pi theme generation kept where useful

The current codebase still contains cmux-era implementation details while the fork is being renamed and migrated.

## Planned behavior

- **`/theme`** — open an inline picker to browse, filter, search, and live-preview embedded themes
- **`/theme "Theme Name"`** — apply a named theme directly
- **`/theme-settings`** — configure preview timing and Pi theme generation parameters
- optional startup sync based on the active terminal state or explicit theme selection

## Install

Not ready for install yet.

This fork is currently in migration from `pi-cmux-theme-picker` to `pi-term`.

## Migration plan

See [PLAN.md](PLAN.md).

## Requirements

Target environment for the new implementation:

- iTerm2
- Pi with `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui`
- Node/Bun toolchain for extension development

## License

MIT
