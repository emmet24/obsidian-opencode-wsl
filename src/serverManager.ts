import { spawn } from "child_process";

const HEALTH_CHECK_INTERVAL = 10000;
const START_TIMEOUT = 15000;

export interface ServerProcess {
	readonly pid?: number;
	kill(signal?: string): void;
	onExit(cb: (code?: number | null, signal?: string | null) => void): void;
	onError(cb: (err: unknown) => void): void;
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

		// Resolve opencode path in WSL
		const opencodeCmd = await this.resolveCommand();
		if (!opencodeCmd) {
			console.error("[opencode-wsl] Could not find opencode in WSL");
			return false;
		}

		const args = this.buildWslArgs([opencodeCmd, "serve",
			"--port", String(this.settings.port),
			"--hostname", "127.0.0.1",
			"--cors", "app://obsidian.md",
		]);

		console.log(`[opencode-wsl] Starting: wsl.exe ${args.join(" ")}`);

		const proc = this.spawnWsl(args);
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

		// Wait for server to become healthy
		const started = await this.waitForHealth(START_TIMEOUT);
		if (!started) {
			console.warn("[opencode-wsl] Server did not become healthy within timeout");
			this.child = null;
			return false;
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

	private async resolveCommand(): Promise<string | null> {
		const cmd = this.settings.opencodePath || "opencode";
		if (cmd.includes("/")) return cmd;

		// Try resolving via bash (non-interactive, clean exit)
		try {
			const result = await this.execWslCapture(
				this.buildWslArgs(["bash", "-c", `command -v "${cmd}" 2>/dev/null || echo MISSING`]),
			);
			const resolved = result.trim().split("\n")[0];
			if (resolved && resolved !== "MISSING") return resolved;
		} catch {
			// Fall through
		}

		// Fallback: check common WSL paths
		const home = await this.wslGetHome();
		const candidates = [
			`${home}/.opencode/bin/${cmd}`,
			`${home}/.npm/bin/${cmd}`,
			`${home}/.local/bin/${cmd}`,
			`/usr/local/bin/${cmd}`,
			`/usr/bin/${cmd}`,
		];
		for (const c of candidates) {
			try {
				await this.execWslCapture(this.buildWslArgs(["test", "-x", c]));
				return c;
			} catch {
				// Try next
			}
		}
		return cmd;
	}

	private async wslGetHome(): Promise<string> {
		try {
			const result = await this.execWslCapture(
				this.buildWslArgs(["bash", "-c", "echo $HOME"]),
			);
			return result.trim() || "/root";
		} catch {
			return "/root";
		}
	}

	private buildWslArgs(cmdArgs: string[]): string[] {
		const args: string[] = [];
		if (this.settings.wslDistro) {
			args.push("-d", this.settings.wslDistro);
		}
		if (this.settings.cwd) {
			args.push("--cd", this.settings.cwd);
		}
		args.push("--", ...cmdArgs);
		return args;
	}

	private spawnWsl(args: string[]): ServerProcess | null {
		try {
			const env: Record<string, string> = {};
			if (this.settings.serverPassword) {
				env.OPENCODE_SERVER_PASSWORD = this.settings.serverPassword;
			}
			const proc = spawn("wsl.exe", args, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, ...env },
			});
			// Log stderr for debugging
			if (proc.stderr) {
				proc.stderr.on("data", (d: Buffer) => {
					console.warn(`[opencode-wsl stderr] ${d.toString().trim()}`);
				});
			}
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

	private async execWslCapture(args: string[], timeoutMs = 10000): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = spawn("wsl.exe", args, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			let error = "";
			const timer = setTimeout(() => {
				proc.kill();
				reject(new Error(`Timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
			proc.stderr?.on("data", (d: Buffer) => { error += d.toString(); });
			proc.on("exit", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve(output);
				else reject(new Error(error || `Exit code ${code}`));
			});
			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}

	private async waitForHealth(timeoutMs: number): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const healthy = await this.checkHealth();
			if (healthy) return true;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		return false;
	}

	private startHealthCheck(): void {
		this.stopHealthCheck();
		this.healthTimer = window.setInterval(() => {
			if (this.shuttingDown) return;
			this.checkHealth().then((healthy) => {
				if (!healthy && !this.child) {
					console.log("[opencode-wsl] Server not healthy, attempting restart...");
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