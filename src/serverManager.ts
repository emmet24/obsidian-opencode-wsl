import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";

const HEALTH_CHECK_INTERVAL = 5000;

export interface ServerProcess {
	readonly pid?: number;
	kill(signal?: string): void;
	onExit(cb: (code?: number | null, signal?: string | null) => void): void;
	onError(cb: (err: unknown) => void): void;
}

export function spawnWslProcess(args: string[]): ServerProcess | null {
	try {
		const proc = spawn("wsl.exe", args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return {
			get pid() { return proc.pid; },
			kill: (s) => { proc.kill(s as any); },
			onExit: (cb) => { proc.on("exit", cb); },
			onError: (cb) => { proc.on("error", cb); },
		};
	} catch {
		return null;
	}
}

export class ServerManager {
	private child: ServerProcess | null = null;
	private healthTimer: number | null = null;
	private shuttingDown = false;

	constructor(
		private settings: {
			port: number;
			wslDistro: string;
			opencodePath: string;
			cwd: string;
			serverPassword: string;
		},
	) {}

	get running(): boolean {
		return this.child !== null;
	}

	async start(): Promise<boolean> {
		if (this.child) {
			console.log("[opencode-wsl] Server already running");
			return true;
		}

		const args: string[] = [];
		if (this.settings.wslDistro) {
			args.push("-d", this.settings.wslDistro);
		}

		// Build the command to run inside WSL
		const cmd = this.settings.opencodePath || "opencode";
		const serveArgs = [
			"serve",
			"--port", String(this.settings.port),
			"--hostname", "127.0.0.1",
			"--cors", "app://obsidian.md",
		];
		if (this.settings.cwd) {
			serveArgs.push("--dir", this.settings.cwd);
		}

		// Set environment variables for the WSL process
		const env: Record<string, string> = {};
		if (this.settings.serverPassword) {
			env.OPENCODE_SERVER_PASSWORD = this.settings.serverPassword;
		}

		args.push("--", ...cmd.split(/\s+/), ...serveArgs);

		console.log(`[opencode-wsl] Starting: wsl.exe ${args.join(" ")}`);

		const proc = spawnWslProcess(args);
		if (!proc) {
			console.error("[opencode-wsl] Failed to spawn wsl.exe");
			return false;
		}

		proc.onExit((code, signal) => {
			this.child = null;
			if (!this.shuttingDown) {
				console.log(`[opencode-wsl] Server exited (code=${code}, signal=${signal})`);
			}
		});

		proc.onError((err) => {
			this.child = null;
			if (!this.shuttingDown) {
				console.error("[opencode-wsl] Server error:", err);
			}
		});

		this.child = proc;

		// Wait for server to start
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Verify server is running
		const healthy = await this.checkHealth();
		if (!healthy) {
			console.warn("[opencode-wsl] Server may not be ready yet, will retry");
		}

		console.log(`[opencode-wsl] Server started (pid=${proc.pid})`);
		this.startHealthCheck();
		return true;
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
				const timer = setTimeout(() => {
					try { proc.kill("SIGKILL"); } catch { /* already dead */ }
					resolve();
				}, 3000);
				proc.onExit(() => {
					clearTimeout(timer);
					resolve();
				});
			});
		} catch (err) {
			console.warn("[opencode-wsl] Error stopping server:", err);
		} finally {
			this.shuttingDown = false;
		}
	}

	async restart(): Promise<boolean> {
		await this.stop();
		await new Promise((resolve) => setTimeout(resolve, 1000));
		return this.start();
	}

	async checkHealth(): Promise<boolean> {
		try {
			const url = `http://127.0.0.1:${this.settings.port}/global/health`;
			const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
			if (response.ok) {
				const data = await response.json() as { healthy?: boolean };
				return data.healthy === true;
			}
			return false;
		} catch {
			return false;
		}
	}

	private startHealthCheck(): void {
		this.stopHealthCheck();
		this.healthTimer = window.setInterval(() => {
			if (this.shuttingDown) return;
			this.checkHealth().then((healthy) => {
				if (!healthy && !this.child) {
					console.log("[opencode-wsl] Server not healthy, restarting...");
					this.start();
				}
			});
		}, HEALTH_CHECK_INTERVAL);
	}

	private stopHealthCheck(): void {
		if (this.healthTimer !== null) {
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