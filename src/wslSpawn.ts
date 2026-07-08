import { spawn } from "child_process";

export interface WslProcess {
	readonly pid?: number;
	kill(signal?: string): void;
	onExit(cb: (code?: number | null, signal?: string | null) => void): void;
	onError(cb: (err: unknown) => void): void;
}

export function wslSpawn(args: string[], env?: Record<string, string>): WslProcess | null {
	try {
		const raw = spawn("wsl.exe", args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: env ? { ...process.env, ...env } : undefined,
		}) as unknown as {
			pid?: number;
			stderr: { on: (e: string, cb: (d: Buffer) => void) => void } | null;
			on: (e: string, cb: (...args: unknown[]) => void) => void;
			kill: (s?: string) => void;
		};
		if (raw.stderr) {
			raw.stderr.on("data", (d: Buffer) => {
				console.warn(`[opencode-wsl stderr] ${d.toString().trim()}`);
			});
		}
		return {
			get pid() { return raw.pid; },
			kill: (s) => { raw.kill(s); },
			onExit: (cb) => { raw.on("exit", cb); },
			onError: (cb) => { raw.on("error", cb); },
		};
	} catch {
		return null;
	}
}

export function wslExecCapture(args: string[], timeoutMs = 10000): Promise<string> {
	return new Promise((resolve, reject) => {
		const raw = spawn("wsl.exe", args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		}) as unknown as {
			stdout: { on: (e: string, cb: (d: Buffer) => void) => void } | null;
			stderr: { on: (e: string, cb: (d: Buffer) => void) => void } | null;
			on: (e: string, cb: (...args: unknown[]) => void) => void;
			kill: (s?: string) => void;
		};
		let output = "";
		let error = "";
		const timer = window.setTimeout(() => {
			raw.kill();
			reject(new Error(`Timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		raw.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
		raw.stderr?.on("data", (d: Buffer) => { error += d.toString(); });
		raw.on("exit", (code) => {
			window.clearTimeout(timer);
			if (code === 0) resolve(output);
			else reject(new Error(error || `Exit code ${code}`));
		});
		raw.on("error", (err) => {
			window.clearTimeout(timer);
			reject(new Error(String(err)));
		});
	});
}

export function taskKill(pid: number): void {
	try {
		spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
			windowsHide: true,
			stdio: "ignore",
		});
	} catch {
		// taskkill not available
	}
}