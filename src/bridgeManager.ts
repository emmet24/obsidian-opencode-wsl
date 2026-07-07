import type OpencodeWslPlugin from "./main";
import type { OpencodeWslSettings } from "./settings";
import { Notice } from "obsidian";
import { BRIDGE_JS_BASE64 } from "./bridgeEmbed";
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";

type ChildProcessHandle = ReturnType<typeof spawn>;

const RESTART_BACKOFF_BASE_MS = 5000;
const RESTART_BACKOFF_MAX_MS = 120000;
const RESTART_NOTICE_THRESHOLD = 3;

export class BridgeManager {
	private plugin: OpencodeWslPlugin;
	private child: ChildProcessHandle | null = null;
	private healthTimer: number | null = null;
	private shuttingDown = false;
	private depsChecked = false;
	private restartCount = 0;
	private restartBackoff = RESTART_BACKOFF_BASE_MS;

	constructor(plugin: OpencodeWslPlugin) {
		this.plugin = plugin;
	}

	get running(): boolean {
		return this.child !== null;
	}

	async start(): Promise<boolean> {
		if (this.child) {
			console.log("[opencode-wsl] Bridge already running");
			return true;
		}

		const bridgeDir = this.plugin.bridgeScriptDir;
		if (!bridgeDir || !bridgeDir.startsWith("/")) {
			console.error("[opencode-wsl] Cannot determine plugin directory");
			new Notice("OpenCode WSL: Failed to determine plugin directory");
			return false;
		}
		const settings: OpencodeWslSettings = this.plugin.settings;

		// Ensure bridge.js exists on disk (extract from embedded source)
		try {
			if (!existsSync(`${bridgeDir}/bridge.js`)) {
				const content = Buffer.from(BRIDGE_JS_BASE64, "base64").toString("utf-8");
				writeFileSync(`${bridgeDir}/bridge.js`, content);
				console.log("[opencode-wsl] Extracted bridge.js from embedded source");
			}
		} catch (err) {
			console.warn("[opencode-wsl] Could not write bridge.js:", err);
		}

		if (!this.depsChecked) {
			const depsReady = await this.ensureDependencies();
			if (!depsReady) {
				console.error("[opencode-wsl] Native dependencies not available, cannot start bridge");
				return false;
			}
			this.depsChecked = true;
		}

		const bridgeScript = `${bridgeDir}/bridge.js`;
		const wslArgs: string[] = [];

		if (settings.wslDistro.trim()) {
			wslArgs.push("-d", settings.wslDistro.trim());
		}

		wslArgs.push("--", settings.nodeCommand, bridgeScript);
		wslArgs.push("--port", String(settings.bridgePort));
		if (settings.cwd) {
			wslArgs.push("--dir", settings.cwd);
		}

		console.log(`[opencode-wsl] Starting bridge: wsl.exe ${wslArgs.join(" ")}`);

		try {
			const proc = spawn("wsl.exe", wslArgs, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			if (proc.stdout) {
				proc.stdout.on("data", (data: Buffer) => {
					const line = data.toString().trim();
					if (line) console.log(`[bridge stdout] ${line}`);
				});
			}
			if (proc.stderr) {
				proc.stderr.on("data", (data: Buffer) => {
					const line = data.toString().trim();
					if (line) console.warn(`[bridge stderr] ${line}`);
				});
			}

			proc.on("exit", (code: number | null | undefined, signal: string | null | undefined) => {
				this.child = null;
				if (!this.shuttingDown) {
					console.log(`[opencode-wsl] Bridge exited (code=${code}, signal=${signal})`);
				}
			});

			proc.on("error", (err: unknown) => {
				this.child = null;
				if (!this.shuttingDown) {
					console.error("[opencode-wsl] Bridge spawn error:", err);
				}
			});

			this.child = proc;

			await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
			if (!this.child) return false;

			console.log(`[opencode-wsl] Bridge started (pid=${proc.pid})`);
			this.restartCount = 0;
			this.restartBackoff = RESTART_BACKOFF_BASE_MS;
			this.startHealthCheck();
			return true;
		} catch (err) {
			console.error("[opencode-wsl] Failed to spawn bridge:", err);
			return false;
		}
	}

	async stop(): Promise<void> {
		this.shuttingDown = true;
		this.stopHealthCheck();
		if (!this.child) return;

		const proc = this.child;
		this.child = null;

		try {
			proc.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const timer = window.setTimeout(() => {
					try { proc.kill("SIGKILL"); } catch { /* already dead */ }
					resolve();
				}, 3000);
				proc.on("exit", () => {
					window.clearTimeout(timer);
					resolve();
				});
			});
		} catch (err) {
			console.warn("[opencode-wsl] Error stopping bridge:", err);
		} finally {
			this.shuttingDown = false;
		}
	}

	async restart(): Promise<boolean> {
		await this.stop();
		return this.start();
	}

	private execWslWait(args: string[], timeoutMs = 120000): Promise<number | null> {
		const proc = this.execWsl(args);
		if (!proc) return Promise.reject(new Error("Failed to spawn WSL"));
		return new Promise((resolve) => {
			const timer = window.setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, timeoutMs);
			proc.stdout?.on("data", (d: Buffer) => console.log(`[wsl] ${d.toString().trim()}`));
			proc.stderr?.on("data", (d: Buffer) => console.warn(`[wsl] ${d.toString().trim()}`));
			proc.on("exit", (code) => { window.clearTimeout(timer); resolve(code ?? null); });
		});
	}

	private async wslTestFile(path: string): Promise<boolean> {
		const proc = this.execWsl(this.buildWslArgs(["test", "-f", path]));
		if (!proc) return false;
		return new Promise((r) => proc.on("exit", (c) => r(c === 0)));
	}

	private async ensureDependencies(): Promise<boolean> {
		const bridgeDir = this.plugin.bridgeScriptDir;
		const ptyPath = `${bridgeDir}/node_modules/node-pty/build/Release/pty.node`;
		const pkgPath = `${bridgeDir}/node_modules/node-pty/package.json`;

		// Already compiled
		if (await this.wslTestFile(ptyPath)) return true;

		// Package not installed at all → auto-install (npm handles prebuilt binaries)
		if (!(await this.wslTestFile(pkgPath))) {
			console.log("[opencode-wsl] Installing node-pty and ws in WSL...");
			const code = await this.execWslWait(this.buildWslArgs([
				"npm", "install", "node-pty", "ws",
				"--prefix", bridgeDir,
			]));
			if (code !== 0) {
				console.error(`[opencode-wsl] npm install failed (code=${code})`);
				return false;
			}
		} else {
			// Package installed but not compiled → rebuild
			console.log("[opencode-wsl] Rebuilding node-pty native binding...");
			const code = await this.execWslWait(this.buildWslArgs([
				"npm", "rebuild", "node-pty", "--prefix", bridgeDir,
			]));
			if (code !== 0) {
				console.error(`[opencode-wsl] npm rebuild failed (code=${code})`);
				return false;
			}
		}

		return await this.wslTestFile(ptyPath);
	}

	private buildWslArgs(cmd: string[]): string[] {
		const args: string[] = [];
		const distro = this.plugin.settings.wslDistro.trim();
		if (distro) args.push("-d", distro);
		args.push("--", ...cmd);
		return args;
	}

	private execWsl(args: string[]): ChildProcessHandle | null {
		try {
			return spawn("wsl.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			console.warn("[opencode-wsl] Failed to exec WSL command");
			return null;
		}
	}

	private startHealthCheck(): void {
		this.stopHealthCheck();
		this.healthTimer = window.setInterval(() => {
			if (this.child) return;
			this.restartCount++;
			if (this.restartCount >= RESTART_NOTICE_THRESHOLD) {
				new Notice(`OpenCode WSL: Bridge keeps crashing (${this.restartCount} restarts)`);
			}
			const delay = Math.min(
				this.restartBackoff * Math.pow(2, this.restartCount - RESTART_NOTICE_THRESHOLD),
				RESTART_BACKOFF_MAX_MS
			);
			this.restartBackoff = Math.max(this.restartBackoff, delay);
			console.log(`[opencode-wsl] Bridge not running, retrying in ${delay}ms...`);
			window.setTimeout(() => this.start(), delay);
		}, RESTART_BACKOFF_BASE_MS);
	}

	private stopHealthCheck(): void {
		if (this.healthTimer) {
			window.clearInterval(this.healthTimer);
			this.healthTimer = null;
		}
	}

	destroy(): void {
		this.shuttingDown = true;
		this.stopHealthCheck();
		if (this.child) {
			try { this.child.kill("SIGTERM"); } catch { /* ignore */ }
			this.child = null;
		}
	}
}