# pi-term

Live iTerm2 theme picker for [Pi](https://pi.dev).

Browse, filter, and live-preview 463 embedded themes in the Pi TUI. Changes apply to both iTerm2 terminal colors and the Pi UI theme simultaneously. Confirmed themes persist to the iTerm2 profile so new tabs and windows inherit them.

## Requirements

- **iTerm2** — macOS only
- **iTerm2 shell integration** — required for the Python API to connect
  - Install via iTerm2 menu: *iTerm2 → Install Shell Integration*
  - Or run: `curl -L https://iterm2.com/shell_integration/install_shell_integration.sh | bash`
- **Python 3** with the `iterm2` package:
  ```bash
  pip3 install iterm2
  ```
- **Pi** (`@mariozechner/pi-coding-agent`)

## Install

```bash
pi install git:git@github.com:victor-software-house/pi-term
```

On first use, iTerm2 will show a one-time authorization dialog — click *Allow*.

## Commands

- **`/theme`** — open the interactive picker
- **`/theme "Theme Name"`** — apply a named theme directly
- **`/theme-settings`** — configure Pi theme generation parameters

## Controls

| Key | Action |
|:----|:-------|
| `↑` / `↓` | navigate |
| type | filter by name |
| `tab` | cycle all / dark / light |
| `backspace` | delete search character |
| `enter` | apply and persist theme |
| `esc` | cancel and restore original colors |

## Features

- **463 embedded themes** — full Ghostty/iTerm2 Color Schemes catalog
- **Live preview** — ~14ms batched protobuf apply via Python bridge
- **Profile persistence** — confirmed themes survive new tabs and windows
- **Exact restore on cancel** — per-session snapshot, not preset-based
- **Pi UI sync** — Pi theme JSON written and applied on confirm

## How it works

A persistent Python subprocess (`iterm2-bridge.py`) communicates with iTerm2 via its native WebSocket/protobuf API. All 22 color properties are sent in a single batched message per preview (~14ms). The bridge is started once at session startup and killed when Pi exits. Preview applies colors session-locally (ephemeral); confirm writes to the actual iTerm2 profile (persistent).

## Development

```bash
bun install
bun run typecheck
```

Conventional Commits enforced. Changeset required for any releasable change — see [AGENTS.md](AGENTS.md).

## License

MIT
