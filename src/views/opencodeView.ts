import { ItemView, WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type OpencodeWslPlugin from "../main";

export const VIEW_TYPE_OPENCODE_WSL = "opencode-wsl-view";

interface WsMessage {
	type: "output" | "input" | "resize" | "exit" | "error";
	data?: string;
	cols?: number;
	rows?: number;
	message?: string;
}

export class OpencodeWslView extends ItemView {
	private plugin: OpencodeWslPlugin;
	private terminal: Terminal | null = null;
	private fitAddon: FitAddon | null = null;
	private ws: WebSocket | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private reconnectTimer: number | null = null;
	private termContainer: HTMLElement | null = null;
	private shouldReconnect = true;
	private connectAttempts = 0;
	private captureHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: OpencodeWslPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_OPENCODE_WSL;
	}

	getDisplayText(): string {
		return "OpenCode WSL";
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen(): Promise<void> {
		// Handle deferred views (Obsidian 1.7.2+)
		const leaf = this.leaf as unknown as { isDeferred?: boolean; loadIfDeferred?: () => Promise<void> };
		if (leaf.isDeferred) {
			await leaf.loadIfDeferred?.();
		}

		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("opencode-wsl-view");

		const termContainer = container.createEl("div", {
			cls: "opencode-wsl-terminal",
		});
		this.termContainer = termContainer;

		const isDark = activeDocument.body.classList.contains("theme-dark");
		const fallbackBg = isDark ? "#1e1e1e" : "#ffffff";
		const fallbackFg = isDark ? "#d4d4d4" : "#333333";

		const computedStyle = getComputedStyle(activeDocument.body);
		const initialBg = computedStyle
			.getPropertyValue("--background-primary")
			.trim();
		const initialFg = computedStyle.getPropertyValue("--text-normal").trim();
		const terminalBg =
			initialBg &&
			initialBg !== "transparent" &&
			initialBg !== "rgba(0, 0, 0, 0)"
				? initialBg
				: fallbackBg;
		const terminalFg = initialFg || fallbackFg;

		termContainer.style.backgroundColor = terminalBg;

		const terminal = new Terminal({
			fontSize: this.plugin.settings.fontSize,
			fontFamily: this.plugin.settings.fontFamily,
			cursorBlink: true,
			scrollback: this.plugin.settings.scrollback,
			convertEol: true,
			allowProposedApi: true,
			theme: {
				background: terminalBg,
				foreground: terminalFg,
				cursor: terminalFg,
				cursorAccent: terminalBg,
				selectionBackground: isDark ? "#264f78" : "#add6ff",
				black: "#666666",
				red: isDark ? "#f44747" : "#cd3131",
				green: isDark ? "#6a9955" : "#0bc765",
				yellow: isDark ? "#dcdcaa" : "#e5e510",
				blue: isDark ? "#569cd6" : "#2470fe",
				magenta: isDark ? "#c586c0" : "#bc3fbc",
				cyan: "#4ec9b0",
				white: terminalFg,
			},
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(termContainer);

		try {
			terminal.loadAddon(new CanvasAddon());
		} catch (e) {
			console.warn(
				"Canvas renderer failed to load, falling back to DOM renderer",
				e
			);
		}

		this.terminal = terminal;
		this.fitAddon = fitAddon;

		// Capture-phase keydown listener fires BEFORE Obsidian's document-level hotkey handlers.
		// This prevents Obsidian from intercepting terminal keys like Ctrl+D (bookmark).
		// Only captures keystrokes inside the terminal container (not password fields, etc.)
		this.captureHandler = (event: KeyboardEvent) => {
			if (!this.termContainer?.contains(event.target as HTMLElement)) return;
			if (event.isComposing) return;
			const seq = this.keyEventToSequence(event);
			if (seq === undefined) return;
			event.stopPropagation();
			event.preventDefault();
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: "input", data: seq }));
			}
		};
		window.addEventListener("keydown", this.captureHandler, { capture: true });

		terminal.onResize(({ cols, rows }) => {
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				const msg: WsMessage = { type: "resize", cols, rows };
				this.ws.send(JSON.stringify(msg));
			}
		});

		const resizeObserver = new ResizeObserver(() => {
			this.fitTerminal();
		});
		resizeObserver.observe(termContainer);
		resizeObserver.observe(container);
		this.resizeObserver = resizeObserver;
		this.register(() => resizeObserver.disconnect());

		this.registerEvent(
			this.app.workspace.on("resize", () => {
				this.fitTerminal();
			})
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.fitTerminal();
			})
		);
		window.addEventListener("resize", this.fitTerminal);
		this.register(() =>
			window.removeEventListener("resize", this.fitTerminal)
		);

		window.setTimeout(() => this.fitTerminal(), 0);
		window.setTimeout(() => this.fitTerminal(), 100);
		window.setTimeout(() => this.fitTerminal(), 300);

		this.plugin.bridgeManager?.start();
		this.connectAttempts = 0;
		this.connectWebSocket();
	}

	async onClose(): Promise<void> {
		this.shouldReconnect = false;

		if (this.captureHandler) {
			window.removeEventListener("keydown", this.captureHandler, { capture: true });
			this.captureHandler = null;
		}

		if (this.reconnectTimer !== null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.disconnectWebSocket();

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		if (this.terminal) {
			try {
				this.terminal.dispose();
			} catch {
				// dispose can throw if already disposed
			}
			this.terminal = null;
		}
	}

	private connectWebSocket(): void {
		const port = this.plugin.settings.bridgePort;
		const url = `ws://127.0.0.1:${port}`;
		this.connectAttempts++;

		if (this.connectAttempts === 1) {
			this.terminal?.write(`\r\n\x1b[33mConnecting to bridge ws://127.0.0.1:${port}...\x1b[0m\r\n`);
		}

		if (this.connectAttempts > 3 && !this.plugin.bridgeManager?.running) {
			const cmd = `wsl.exe -- node ${this.plugin.bridgeScriptDir}/bridge.js --port ${port} --dir ${this.plugin.settings.cwd}`;
			const lines = [
				`\r\n\x1b[31mCannot reach bridge server\x1b[0m`,
				`\r\n  Make sure the bridge is running in WSL:`,
				`\r\n    ${cmd}`,
				`\r\n  Or enable Settings → Auto-start bridge and reload Obsidian.`,
				`\r\n\x1b[33mRetrying in ${this.plugin.settings.reconnectDelay}ms...\x1b[0m\r\n`,
			];
			this.terminal?.write(lines.join(""));
		}

		try {
			const ws = new WebSocket(url);
			const timeout = window.setTimeout(() => {
				if (ws.readyState !== WebSocket.OPEN) {
					ws.close();
				}
			}, 5000);

			ws.onopen = () => {
				window.clearTimeout(timeout);
				this.onWsOpen();
			};
			ws.onmessage = (event: MessageEvent) => {
				this.onWsMessage(event);
			};
			ws.onclose = () => {
				window.clearTimeout(timeout);
				this.onWsClose();
			};
			ws.onerror = () => {
				// ws protocol: onclose always fires after onerror, so we handle reconnect there
			};
			this.ws = ws;
		} catch (e) {
			console.warn("OpenCode WSL: WebSocket connection failed:", e);
			this.scheduleReconnect();
		}
	}

	private disconnectWebSocket(): void {
		if (this.ws) {
			this.ws.onopen = null;
			this.ws.onmessage = null;
			this.ws.onclose = null;
			this.ws.onerror = null;
			if (
				this.ws.readyState === WebSocket.OPEN ||
				this.ws.readyState === WebSocket.CONNECTING
			) {
				this.ws.close();
			}
			this.ws = null;
		}
	}

	private onWsOpen(): void {
		if (!this.terminal || !this.fitAddon) return;
		this.connectAttempts = 0;

		try {
			this.fitAddon.fit();
		} catch {
			// ignore
		}

		const cols = this.terminal.cols;
		const rows = this.terminal.rows;
		const msg: WsMessage = {
			type: "resize",
			cols,
			rows,
		};
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}

		this.terminal.clear();
		this.terminal.write(
			`\x1b[32mConnected to WSL bridge on port ${this.plugin.settings.bridgePort}\x1b[0m\r\n`
		);
	}

	private onWsMessage(event: MessageEvent): void {
		if (!this.terminal) return;

		try {
			const msg = JSON.parse(event.data as string) as WsMessage;

			switch (msg.type) {
				case "output":
					if (msg.data) {
						this.terminal.write(msg.data);
					}
					break;
				case "exit":
					if (msg.data) {
						this.terminal.write(
							`\r\n\x1b[33mProcess exited with code ${msg.data}\x1b[0m\r\n`
						);
					}
					break;
				case "error":
					if (msg.message) {
						this.terminal.write(
							`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`
						);
					}
					break;
			}
		} catch {
			if (this.terminal) {
				this.terminal.write(event.data as string);
			}
		}
	}

	private onWsClose(): void {
		if (this.connectAttempts <= 1 && this.terminal) {
			this.terminal.write(
				`\r\n\x1b[33mDisconnected from bridge server\x1b[0m\r\n`
			);
		}
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (!this.shouldReconnect) return;

		this.reconnectTimer = window.window.setTimeout(() => {
			if (!this.shouldReconnect) return;
			this.connectWebSocket();
		}, this.plugin.settings.reconnectDelay);
	}

	private fitTerminal = (): void => {
		if (!this.fitAddon || !this.termContainer) return;
		if (
			this.termContainer.clientWidth > 0 &&
			this.termContainer.clientHeight > 0
		) {
			try {
				this.fitAddon.fit();
			} catch {
				// fit can fail during rapid layout changes (e.g. sidebar resize)
			}
		}
	};

	private keyEventToSequence(event: KeyboardEvent): string | undefined {
		const mod = event.ctrlKey || event.metaKey;
		const alt = event.altKey;
		const shift = event.shiftKey;
		const key = event.key;

		if (mod && !alt && (key === "p" || key === ",")) return undefined;

		if (mod && !alt && key.length === 1) {
			const code = key.charCodeAt(0);
			if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60);
			if (code >= 0x41 && code <= 0x5a) return String.fromCharCode(code - 0x40);
		}

		switch (key) {
			case "Enter": return "\r";
			case "Tab": return shift ? "\x1b[Z" : "\t";
			case "Escape": return "\x1b";
			case "Backspace": return "\x7f";
			case "ArrowUp": return "\x1b[A";
			case "ArrowDown": return "\x1b[B";
			case "ArrowRight": return "\x1b[C";
			case "ArrowLeft": return "\x1b[D";
			case "Home": return "\x1b[H";
			case "End": return "\x1b[F";
			case "PageUp": return "\x1b[5~";
			case "PageDown": return "\x1b[6~";
			case "Delete": return "\x1b[3~";
		}

		if (!mod && !alt && key.length === 1) return key;

		if (mod && alt && key.length === 1) {
			const code = key.toLowerCase().charCodeAt(0);
			if (code >= 0x61 && code <= 0x7a) return "\x1b" + String.fromCharCode(code - 0x60);
		}

		return "";
	}
}