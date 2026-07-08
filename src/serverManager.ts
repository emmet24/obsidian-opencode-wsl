import { requestUrl } from "obsidian";
import { wslSpawn, wslExecCapture, taskKill, type WslProcess } from "./wslSpawn";

const HEALTH_CHECK_INTERVAL = 10000;
const START_TIMEOUT = 15000;

export class ServerManager {
	private child: WslProcess | null = null;
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

		const env: Record<string, string> = {};
		if (this.settings.serverPassword) {
			env.OPENCODE_SERVER_PASSWORD = this.settings.serverPassword;
		}
		const proc = wslSpawn(args, env);
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
			if (proc.pid) {
				taskKill(proc.pid);
			}
			proc.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const timer = window.setTimeout(() => {
					try { proc.kill("SIGKILL"); } catch { /* already dead */ }
					resolve();
				}, 3000);
				proc.onExit(() => {
					window.clearTimeout(timer);
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
		await new Promise((resolve) => window.setTimeout(resolve, 1000));
		return this.start();
	}

	async checkHealth(): Promise<boolean> {
		try {
			const url = `http://127.0.0.1:${this.settings.port}/global/health`;
			const response = await requestUrl({ url, method: "GET" });
			if (response.status === 200) {
				const data = response.json as { healthy?: boolean };
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

		try {
			const result = await wslExecCapture(
				this.buildWslArgs(["bash", "-c", `command -v "${cmd}" 2>/dev/null || echo MISSING`]),
			);
			const resolved = result.trim().split("\n")[0];
			if (resolved && resolved !== "MISSING") return resolved;
		} catch {
			// Fall through
		}

		const home = await wslExecCapture(this.buildWslArgs(["bash", "-c", "echo $HOME"])).then(
			(r) => r.trim() || "/root",
			() => "/root",
		);
		const candidates = [
			`${home}/.opencode/bin/${cmd}`,
			`${home}/.npm/bin/${cmd}`,
			`${home}/.local/bin/${cmd}`,
			`/usr/local/bin/${cmd}`,
			`/usr/bin/${cmd}`,
		];
		for (const c of candidates) {
			try {
				await wslExecCapture(this.buildWslArgs(["test", "-x", c]));
				return c;
			} catch {
				// Try next
			}
		}
		return cmd;
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

	private async waitForHealth(timeoutMs: number): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const healthy = await this.checkHealth();
			if (healthy) return true;
			await new Promise((resolve) => window.setTimeout(resolve, 500));
		}
		return false;
	}

	private startHealthCheck(): void {
		this.stopHealthCheck();
		this.healthTimer = window.setInterval(() => {
			if (this.shuttingDown) return;
			void this.checkHealth().then((healthy) => {
				if (!healthy && !this.child) {
					console.log("[opencode-wsl] Server not healthy, attempting restart...");
					void this.start();
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
			const proc = this.child;
			this.child = null;
			if (proc.pid) {
				taskKill(proc.pid);
			}
			try { proc.kill("SIGTERM"); } catch { /* ignore */ }
		}
	}
}
