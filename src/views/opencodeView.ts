import { ItemView, WorkspaceLeaf } from "obsidian";
import type OpencodePlugin from "../main";

export const VIEW_TYPE = "opencode-wsl-view";

export class OpencodeView extends ItemView {
	private plugin: OpencodePlugin;
	private iframe: HTMLIFrameElement | null = null;
	private statusEl: HTMLElement | null = null;
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

		const statusEl = container.createEl("div", {
			cls: "opencode-iframe-status",
		});
		this.statusEl = statusEl;

		const startBtn = container.createEl("button", {
			cls: "opencode-iframe-start-btn",
			text: "Start OpenCode",
		});
		startBtn.addEventListener("click", () => {
			this.startServer();
		});
		this.startBtn = startBtn;

		this.iframe = container.createEl("iframe", {
			cls: "opencode-iframe",
			attr: {
				src: "about:blank",
				frameborder: "0",
				allow: "clipboard-read; clipboard-write",
			},
		});

		if (this.plugin.settings.autoStart) {
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
		this.showStatus("Starting OpenCode server...", "loading");
		const ok = await this.plugin.serverManager.start();
		if (ok) {
			this.loadIframe();
		} else {
			this.showStatus("Failed to start OpenCode server", "error");
		}
	}

	private loadIframe(): void {
		if (!this.iframe) return;
		const url = `http://127.0.0.1:${this.plugin.settings.port}/`;
		this.iframe.src = url;
		this.showStatus("Connected", "connected");
	}

	private showStatus(message: string, type: "loading" | "error" | "connected" | "stopped"): void {
		if (!this.statusEl || !this.iframe || !this.startBtn) return;
		this.statusEl.setText(message);
		this.statusEl.className = `opencode-iframe-status opencode-iframe-status-${type}`;
		if (type === "connected") {
			this.statusEl.style.display = "none";
			this.startBtn.style.display = "none";
			this.iframe.style.display = "flex";
		} else if (type === "stopped") {
			this.statusEl.style.display = "flex";
			this.startBtn.style.display = "inline-block";
			this.iframe.style.display = "none";
		} else {
			this.statusEl.style.display = "flex";
			this.startBtn.style.display = "none";
			this.iframe.style.display = "none";
		}
	}
}