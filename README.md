# pi-term

Live iTerm2 theme picker for [Pi](https://pi.dev).

Browse, filter, and live-preview 463 embedded themes directly in the Pi TUI. Changes apply to both iTerm2 colors (via `@shadr/iterm2-ts`) and the Pi UI theme simultaneously.

## Commands

- **`/theme`** — open the interactive picker: search, filter dark/light, navigate with arrow keys, preview on the fly
- **`/theme "Theme Name"`** — apply a named theme directly without the picker
- **`/theme-settings`** — configure Pi theme generation parameters (color source mapping, weights, tints)

## Controls

| Key | Action |
|:----|:-------|
| `↑` / `↓` | navigate |
| `type` | filter by name |
| `tab` | cycle all / dark / light |
| `backspace` | delete search character |
| `enter` | apply selected theme |
| `esc` | cancel and restore original colors |

## Features

- **463 embedded themes** — full iTerm2 Color Schemes catalog, no runtime file system access
- **Live preview** — ~260ms parallel apply via `@shadr/iterm2-ts`; trailing-only debounce keeps keyboard input instant
- **Exact restore on cancel** — per-session snapshot, not named-preset based
- **Pi UI sync** — Pi theme JSON written and applied on confirm
- **Per-theme parameter overrides** — tune color mapping per theme slug via `/theme-settings`

## Install

```bash
pi install github:victor-software-house/pi-term
```

Requires iTerm2. First use will show a one-time iTerm2 authorization dialog.

## Requirements

- iTerm2
- Pi (`@mariozechner/pi-coding-agent` + `@mariozechner/pi-tui`)
- Bun or Node for development

## Development

```bash
bun install
bun run typecheck
```

Conventional Commits are enforced. A changeset is required for any releasable change — see [AGENTS.md](AGENTS.md) for full commit and release workflow.

## License

MIT
