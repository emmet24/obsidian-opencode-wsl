import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { BRIDGE_JS_BASE64 } from "./bridgeEmbed";

export interface WslProcess {
	readonly pid?: number;
	readonly running: boolean;
	kill(signal?: string): void;
	onExit(cb: (code?: number | null, signal?: string | null) => void): void;
	onError(cb: (err: unknown) => void): void;
	onStdout(cb: (data: string) => void): void;
	onStderr(cb: (data: string) => void): void;
}

export function ensureBridgeJs(dir: string): void {
	if (!existsSync(`${dir}/bridge.js`)) {
		const content = Buffer.from(BRIDGE_JS_BASE64, "base64").toString("utf-8");
		writeFileSync(`${dir}/bridge.js`, content);
	}
}

export function spawnWslProcess(args: string[]): WslProcess | null {
	try {
		const proc = spawn("wsl.exe", args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return {
			get pid() { return proc.pid; },
			get running() { return proc.exitCode === null && proc.killed === false; },
			kill: (signal) => { proc.kill(signal as NodeJS.Signals); },
			onExit: (cb) => { proc.on("exit", cb); },
			onError: (cb) => { proc.on("error", cb); },
			onStdout: (cb) => {
				if (proc.stdout) {
					proc.stdout.on("data", (d: Buffer) => cb(d.toString().trim()));
				}
			},
			onStderr: (cb) => {
				if (proc.stderr) {
					proc.stderr.on("data", (d: Buffer) => cb(d.toString().trim()));
				}
			},
		};
	} catch {
		return null;
	}
}

export function execWslWait(args: string[], timeoutMs = 120000): Promise<number | null> {
	const proc = spawnWslProcess(args);
	if (!proc) return Promise.reject(new Error("Failed to spawn WSL"));
	return new Promise((resolve) => {
		const timer = window.setTimeout(() => { proc.kill(); resolve(null); }, timeoutMs);
		proc.onStdout((d) => console.log(`[wsl] ${d}`));
		proc.onStderr((d) => console.warn(`[wsl] ${d}`));
		proc.onExit((code) => { window.clearTimeout(timer); resolve(code ?? null); });
	});
}

export function wslTestFile(dir: string, distro: string, path: string): Promise<boolean> {
	const args: string[] = [];
	if (distro) args.push("-d", distro);
	args.push("--", "test", "-f", path);
	const proc = spawnWslProcess(args);
	if (!proc) return Promise.resolve(false);
	return new Promise((r) => proc.onExit((c) => r(c === 0)));
}

export function buildWslArgs(cmd: string[], distro: string): string[] {
	const args: string[] = [];
	if (distro) args.push("-d", distro);
	args.push("--", ...cmd);
	return args;
}