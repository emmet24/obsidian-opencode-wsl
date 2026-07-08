import { ItemView, WorkspaceLeaf } from "obsidian";
import type OpencodePlugin from "../main";

export const VIEW_TYPE = "opencode-wsl-view";

export class OpencodeView extends ItemView {
	private plugin: OpencodePlugin;
	private iframe: HTMLIFrameElement | null = null;
	private statusEl: HTMLElement | null = null;

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

		this.iframe = container.createEl("iframe", {
			cls: "opencode-iframe",
			attr: {
				src: "about:blank",
				frameborder: "0",
				allow: "clipboard-read; clipboard-write",
			},
		});

		this.showStatus("Starting OpenCode server...", "loading");

		const ok = await this.plugin.serverManager.start();
		if (ok) {
			this.loadIframe();
		} else {
			this.showStatus("Failed to start OpenCode server", "error");
		}
	}

	async onClose(): Promise<void> {
		if (this.iframe) {
			this.iframe.src = "about:blank";
			this.iframe = null;
		}
	}

	private loadIframe(): void {
		if (!this.iframe) return;
		const url = `http://127.0.0.1:${this.plugin.settings.port}/`;
		this.iframe.src = url;
		this.showStatus("Connected", "connected");
	}

	private showStatus(message: string, type: "loading" | "error" | "connected"): void {
		if (!this.statusEl || !this.iframe) return;
		this.statusEl.setText(message);
		this.statusEl.className = `opencode-iframe-status opencode-iframe-status-${type}`;
		if (type === "connected") {
			this.statusEl.style.display = "none";
			this.iframe.style.display = "flex";
		} else {
			this.statusEl.style.display = "flex";
			this.iframe.style.display = "none";
		}
	}
}
