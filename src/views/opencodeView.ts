import { ItemView, WorkspaceLeaf } from "obsidian";
import type OpencodePlugin from "../main";

export const VIEW_TYPE = "opencode-wsl-view";

export class OpencodeView extends ItemView {
	private plugin: OpencodePlugin;
	private iframe: HTMLIFrameElement | null = null;
	private statusEl: HTMLElement | null = null;
	private statusText: HTMLElement | null = null;
	private startBtn: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: OpencodePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "OpenCode";
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("opencode-iframe-view");

		// Status wrapper: vertically centers status text + start button
		const statusEl = container.createEl("div", {
			cls: "opencode-iframe-status",
		});
		const statusText = statusEl.createEl("div", { cls: "opencode-iframe-status-text" });
		const startBtn = statusEl.createEl("button", {
			cls: "opencode-iframe-start-btn",
			text: "Start OpenCode",
		});
		startBtn.addEventListener("click", () => {
			this.startServer();
		});
		this.statusEl = statusEl;
		this.statusText = statusText;
		this.startBtn = startBtn;

		this.iframe = container.createEl("iframe", {
			cls: "opencode-iframe",
			attr: {
				src: "about:blank",
				frameborder: "0",
				allow: "clipboard-read; clipboard-write",
			},
		});

		if (this.plugin.settings.autoStart || this.plugin.serverManager.running) {
			this.startServer();
		} else {
			this.showStatus("Click 'Start OpenCode' to launch", "stopped");
		}
	}

	async onClose(): Promise<void> {
		if (this.iframe) {
			this.iframe.src = "about:blank";
			this.iframe = null;
		}
	}

	private async startServer(): Promise<void> {
		console.log("[opencode-wsl] startServer called");
		this.showStatus("Starting OpenCode server...", "loading");
		try {
			const ok = await this.plugin.serverManager.start();
			console.log("[opencode-wsl] start() returned:", ok);
			if (ok) {
				this.loadIframe();
			} else {
				this.showStatus("Failed to start OpenCode server. Check console for details.", "error");
			}
		} catch (err) {
			console.error("[opencode-wsl] startServer error:", err);
			this.showStatus("Error: " + String(err), "error");
		}
	}

	private loadIframe(): void {
		if (!this.iframe) return;
		const url = `http://127.0.0.1:${this.plugin.settings.port}/`;
		this.iframe.src = url;
		this.showStatus("Connected", "connected");
	}

	private showStatus(message: string, type: "loading" | "error" | "connected" | "stopped"): void {
		if (!this.statusText || !this.iframe || !this.startBtn || !this.statusEl) return;
		this.statusText.setText(message);
		this.statusEl.className = `opencode-iframe-status opencode-iframe-status-${type}`;
		this.iframe.className = `opencode-iframe opencode-iframe-${type}`;
		this.startBtn.className = `opencode-iframe-start-btn opencode-iframe-start-${type}`;
	}
}