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
4. Select your vault project in the web UI to start

### Auto-start

When enabled (default), the server starts automatically when you open the sidebar panel.
When disabled, click "Start OpenCode" in the panel to launch the server manually.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-start server | ON | Start server automatically when panel opens |
| Server port | 14096 | Port for the OpenCode server |
| WSL distribution | (default) | Leave empty to use the default WSL distro |
| OpenCode path (WSL) | opencode | Path to the opencode executable inside WSL |
| Working directory (WSL path) | auto-detected | Working directory passed via `wsl.exe --cd` |
| Server password | (empty) | `OPENCODE_SERVER_PASSWORD` for auth |

## Development

```bash
git clone https://github.com/emmet24/obsidian-opencode-wsl.git
cd obsidian-opencode-wsl
npm install
npm run build
```

## Files

```
opencode-wsl/
├── src/
│   ├── main.ts           # Plugin entry, settings tab, view registration
│   ├── settings.ts       # Settings interface and defaults
│   ├── serverManager.ts  # WSL opencode serve process lifecycle
│   └── views/
│       └── opencodeView.ts  # iframe-based sidebar view
├── esbuild.config.mjs    # Build configuration
├── manifest.json         # Plugin metadata
├── styles.css            # iframe and status styles
└── package.json          # Dependencies
```

## Branches

| Branch | Version | Approach |
|--------|---------|----------|
| `main` | 2.0.0 | ✅ iframe embedding of OpenCode web UI (current) |
| (git history) | 1.0.3 | PTY bridge + xterm.js TUI (archived) |

## Related

- [OpenCode](https://github.com/anomalyco/opencode) — The AI platform
- [opencode-obsidian](https://github.com/mtymek/opencode-obsidian) — Similar plugin by mtymek

## License

MIT
