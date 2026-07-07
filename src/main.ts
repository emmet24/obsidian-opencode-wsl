import {
	Plugin,
	App,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import { OpencodeWslSettings, DEFAULT_SETTINGS } from "./settings";
import { OpencodeWslView, VIEW_TYPE_OPENCODE_WSL } from "./views/opencodeView";
import { BridgeManager } from "./bridgeManager";

export default class OpencodeWslPlugin extends Plugin {
	settings: OpencodeWslSettings;
	bridgeManager: BridgeManager;

	get bridgeScriptDir(): string {
		const vaultPath = this.detectWslVaultPath();
		if (!vaultPath) return "";
		return `${vaultPath}/.obsidian/plugins/opencode-wsl`;
	}

	async onload(): Promise<void> {
		// Platform guard: WSL is Windows-only
		if (process.platform !== "win32") {
			new Notice("OpenCode WSL requires Windows + WSL");
			return;
		}

		await this.loadSettings();

		// Auto-detect vault WSL path for cwd
		const wslPath = this.detectWslVaultPath();
		if (wslPath && !this.settings.cwd) {
			this.settings.cwd = wslPath;
			await this.saveSettings();
		}

		this.bridgeManager = new BridgeManager(this);

		this.registerView(
			VIEW_TYPE_OPENCODE_WSL,
			(leaf: WorkspaceLeaf) => new OpencodeWslView(leaf, this)
		);

		this.addRibbonIcon("terminal", "OpenCode WSL", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "toggle-terminal",
			name: "OpenCode: Toggle WSL Terminal",
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new OpencodeWslSettingTab(this.app, this));
	}

	onunload(): void {
		this.bridgeManager.destroy();
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_OPENCODE_WSL)
			.forEach((leaf) => leaf.detach());
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_WSL);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({
			type: VIEW_TYPE_OPENCODE_WSL,
			active: true,
		});

		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<OpencodeWslSettings> | null;
		const merged = Object.assign({}, DEFAULT_SETTINGS, data ?? {}) as OpencodeWslSettings;
		// Strip keys not in DEFAULT_SETTINGS (schema drift cleanup)
		for (const key of Object.keys(merged)) {
			if (!(key in DEFAULT_SETTINGS)) {
				delete (merged as Record<string, unknown>)[key];
			}
		}
		this.settings = merged;
	}

	async saveSettings(): Promise<void> {
		try {
			await this.saveData(this.settings);
		} catch (err) {
			console.error("[opencode-wsl] Failed to save settings:", err);
			new Notice("OpenCode WSL: Failed to save settings");
		}
	}

	private detectWslVaultPath(): string | null {
		try {
			const adapter = this.app.vault.adapter;
			if (!("getBasePath" in adapter)) return null;
			const winPath = (adapter as any).getBasePath() as string;
			const match = winPath.match(/^([A-Za-z]):(.*)$/);
			if (!match) return null;
			return `/mnt/${match[1].toLowerCase()}${match[2].replace(/\\/g, "/")}`;
		} catch {
			return null;
		}
	}
}

class OpencodeWslSettingTab extends PluginSettingTab {
	plugin: OpencodeWslPlugin;

	constructor(app: App, plugin: OpencodeWslPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	formatScrollback(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Bridge port")
			.setDesc("WebSocket port for the WSL bridge server")
			.addText((text) =>
				text
					.setPlaceholder("8765")
					.setValue(String(this.plugin.settings.bridgePort))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0 && num < 65536) {
							this.plugin.settings.bridgePort = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Working directory (WSL path)")
			.setDesc("Default working directory inside WSL")
			.addText((text) =>
				text
					.setPlaceholder("/mnt/c/Users/.../my-vault")
					.setValue(this.plugin.settings.cwd)
					.onChange(async (value) => {
						this.plugin.settings.cwd = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("WSL distribution")
			.setDesc(
				"Leave empty to use the default WSL distribution"
			)
			.addText((text) =>
				text
					.setPlaceholder("Ubuntu")
					.setValue(this.plugin.settings.wslDistro)
					.onChange(async (value) => {
						this.plugin.settings.wslDistro = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Terminal font size")
			.setDesc("Font size for the terminal (8–32)")
			.addSlider((slider) => {
				const valueLabel = createSpan({ text: String(this.plugin.settings.fontSize), cls: "opencode-wsl-slider-value" });
				slider
					.setLimits(8, 32, 1)
					.setValue(this.plugin.settings.fontSize)
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						valueLabel.textContent = String(value);
						await this.plugin.saveSettings();
					});
				slider.sliderEl.parentElement?.appendChild(valueLabel);
			});

		new Setting(containerEl)
			.setName("Terminal font family")
			.setDesc("Font family for the terminal")
			.addText((text) =>
				text
					.setPlaceholder("monospace")
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (value) => {
						this.plugin.settings.fontFamily = value || "monospace";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Reconnect delay")
			.setDesc("Milliseconds to wait before reconnecting on disconnect")
			.addSlider((slider) => {
				const valueLabel = createSpan({ text: `${this.plugin.settings.reconnectDelay}ms`, cls: "opencode-wsl-slider-value" });
				slider
					.setLimits(500, 30000, 500)
					.setValue(this.plugin.settings.reconnectDelay)
					.onChange(async (value) => {
						this.plugin.settings.reconnectDelay = value;
						valueLabel.textContent = `${value}ms`;
						await this.plugin.saveSettings();
					});
				slider.sliderEl.parentElement?.appendChild(valueLabel);
			});

		new Setting(containerEl)
			.setName("Scrollback buffer")
			.setDesc("Number of lines to keep in scrollback")
			.addSlider((slider) => {
				const valueLabel = createSpan({ text: this.formatScrollback(this.plugin.settings.scrollback), cls: "opencode-wsl-slider-value" });
				slider
					.setLimits(1000, 50000, 1000)
					.setValue(this.plugin.settings.scrollback)
					.onChange(async (value) => {
						this.plugin.settings.scrollback = value;
						valueLabel.textContent = this.formatScrollback(value);
						await this.plugin.saveSettings();
					});
				slider.sliderEl.parentElement?.appendChild(valueLabel);
			});

		new Setting(containerEl).setName("Bridge server").setHeading();

		new Setting(containerEl)
			.setName("Node command")
			.setDesc("Command used inside WSL to run Node.js (e.g. node, /usr/bin/node)")
			.addText((text) =>
				text
					.setPlaceholder("node")
					.setValue(this.plugin.settings.nodeCommand)
					.onChange(async (value) => {
						this.plugin.settings.nodeCommand = value || "node";
						await this.plugin.saveSettings();
					})
			);

		const status = this.plugin.bridgeManager?.running ? "running" : "stopped";
		new Setting(containerEl)
			.setName("Bridge status")
			.setDesc(`Bridge server is currently ${status}`)
			.addButton((btn) =>
				btn
					.setButtonText(this.plugin.bridgeManager?.running ? "Stop" : "Start")
					.setCta()
					.onClick(async () => {
						if (this.plugin.bridgeManager?.running) {
							await this.plugin.bridgeManager.stop();
							new Notice("Bridge stopped");
						} else {
							const ok = await this.plugin.bridgeManager.start();
							new Notice(ok ? "Bridge started" : "Bridge failed to start");
						}
						this.display();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Restart")
					.onClick(async () => {
						await this.plugin.bridgeManager.restart();
						new Notice("Bridge restarted");
						this.display();
					})
			);
	}
}