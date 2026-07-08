# OpenCode WSL — Obsidian Plugin

Embed [OpenCode](https://opencode.ai) web UI in the Obsidian sidebar via WSL.

## Architecture

```
Obsidian (Windows)                    WSL (Linux)
┌─────────────────────┐              ┌──────────────────────┐
│  <iframe>           │ ← HTTP/SSE →│  opencode serve      │
│  OpenCode Web UI    │  127.0.0.1  │  (REST API + Web UI) │
└─────────────────────┘              └──────────────────────┘
```

## Requirements

- **Windows 10/11** with [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) installed
- **OpenCode CLI** installed inside WSL (`curl -fsSL https://opencode.ai/install.sh | bash`)
- **Obsidian** v1.4.0+

## Installation

### Via BRAT

1. Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)
2. Run `BRAT: Add a beta plugin for testing`
3. Enter `https://github.com/emmet24/obsidian-opencode-wsl`

### Manual

1. Download the latest release from [GitHub releases](https://github.com/emmet24/obsidian-opencode-wsl/releases)
2. Extract to `<vault>/.obsidian/plugins/opencode-wsl/`
3. Enable the plugin in Settings → Community plugins

## Usage

1. Click the terminal icon in the left ribbon, or run `Toggle OpenCode panel` from the command palette
2. The OpenCode server starts automatically inside WSL
3. The OpenCode web UI appears in the right sidebar
4. Use OpenCode as you would in a browser

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Server port | 14096 | Port for the OpenCode server |
| WSL distribution | (default) | Leave empty to use the default WSL distro |
| OpenCode path (WSL) | opencode | Path to the opencode executable inside WSL |
| Working directory (WSL path) | auto-detected | Default working directory inside WSL |
| Server password | (empty) | OPENCODE_SERVER_PASSWORD for auth |

## Development

```bash
git clone https://github.com/emmet24/obsidian-opencode-wsl.git
cd obsidian-opencode-wsl
npm install
npm run build
```

## Related

- [OpenCode](https://github.com/anomalyco/opencode) — The AI platform
- [opencode-obsidian](https://github.com/mtymek/opencode-obsidian) — Similar plugin by mtymek

## License

MIT
