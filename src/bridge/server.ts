/**
 * OpenCode WSL Bridge Server
 *
 * Run inside WSL to expose OpenCode TUI to the Windows-side Obsidian plugin.
 *
 * Usage:
 *   npx tsx server.ts [--port 8765] [--opencode /path/to/opencode] [--dir /working/dir]
 *
 * Or install dependencies and run directly:
 *   npm install node-pty ws
 *   node server.js
 */

import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import * as cp from "child_process";
import * as fs from "fs";

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const PORT = Number(getArg("port", "8765"));
const DEFAULT_CWD = getArg("dir", process.env.HOME || "/root");

function resolveCommand(cmd: string): string {
  if (cmd.includes("/")) return cmd;
  try {
    const result = cp.execSync(`command -v "${cmd}"`, { encoding: "utf8", timeout: 3000 });
    const resolved = result.trim().split("\n")[0];
    if (resolved) return resolved;
  } catch { /* command -v not available or cmd not found */ }
  const home = process.env.HOME || "/root";
  const candidates = [
    `${home}/.opencode/bin/${cmd}`,
    `${home}/.npm/bin/${cmd}`,
    `${home}/.local/bin/${cmd}`,
    `/usr/local/bin/${cmd}`,
    `/usr/bin/${cmd}`,
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* not executable, try next */ }
  }
  throw new Error(
    `Command "${cmd}" not found. Tried: command -v, then checked: ${candidates.join(", ")}`
  );
}
let OPENCODE_CMD: string;
try {
  OPENCODE_CMD = resolveCommand(getArg("opencode", "opencode"));
} catch (e) {
  console.error(`[opencode-wsl-bridge] ${e.message}`);
  process.exit(1);
}

interface BridgeMessage {
  type: "input" | "resize" | "output" | "exit";
  data?: string;
  cols?: number;
  rows?: number;
  exitCode?: number;
  signal?: number;
}

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (ws) => {
  log(`Client connected from ${ws._socket?.remoteAddress}`);

  let shell: IPty | null = null;

try {
		const env: Record<string, string> = {
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			HOME: process.env.HOME || "/root",
			USER: process.env.USER || "root",
			PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
			LANG: process.env.LANG || "en_US.UTF-8",
			SHELL: process.env.SHELL || "/bin/bash",
		};
		shell = pty.spawn(OPENCODE_CMD, [], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: DEFAULT_CWD,
			env,
		});
	} catch (err) {
		const shellErr = String(err);
		log(`Failed to spawn ${OPENCODE_CMD}: ${shellErr}`);
		const hint = shellErr.includes("ENOENT")
			? `\r\n  Install it:  curl -fsSL https://get.opencode.com | bash\r\n`
			: shellErr.includes("Permission denied")
			? `\r\n  Check permissions: which ${OPENCODE_CMD} && ls -la $(which ${OPENCODE_CMD})\r\n`
			: `\r\n`;
		ws.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31mFailed to start: ${OPENCODE_CMD}\x1b[0m\r\n  ${shellErr}${hint}\r\n` }));
		ws.close();
		return;
	}

  log(`Spawned ${OPENCODE_CMD} (pid=${shell.pid})`);

  shell.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      const msg: BridgeMessage = { type: "output", data };
      ws.send(JSON.stringify(msg));
    }
  });

  shell.onExit(({ exitCode, signal }) => {
    log(`${OPENCODE_CMD} exited (code=${exitCode}, signal=${signal})`);
    if (ws.readyState === WebSocket.OPEN) {
      const msg: BridgeMessage = { type: "exit", exitCode: exitCode ?? undefined, signal: signal ?? undefined };
      ws.send(JSON.stringify(msg));
    }
    ws.close();
  });

  ws.on("message", (raw) => {
    try {
      const msg: BridgeMessage = JSON.parse(raw.toString());

      if (msg.type === "input" && msg.data != null) {
        shell?.write(msg.data);
      } else if (msg.type === "resize" && msg.cols != null && msg.rows != null) {
        shell?.resize(msg.cols, msg.rows);
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on("close", () => {
    log("Client disconnected");
    if (shell) {
      shell.kill();
      shell = null;
    }
  });

  ws.on("error", (err) => {
    log(`WebSocket error: ${err.message}`);
  });
});

console.log(`[opencode-wsl-bridge] Listening on ws://127.0.0.1:${PORT}`);
console.log(`  Command: ${OPENCODE_CMD}`);
console.log(`  Working dir: ${DEFAULT_CWD}`);
console.log("  Waiting for Obsidian connection...");

function log(msg: string) {
  console.log(`[opencode-wsl-bridge] ${msg}`);
}