import {
	Plugin,
	App,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import { OpencodeSettings, DEFAULT_SETTINGS } from "./settings";
import { OpencodeView, VIEW_TYPE } from "./views/opencodeView";
import { ServerManager } from "./serverManager";

export default class OpencodePlugin extends Plugin {
	settings: OpencodeSettings;
	serverManager: ServerManager;

	async onload(): Promise<void> {
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

		this.serverManager = new ServerManager({
			port: this.settings.port,
			wslDistro: this.settings.wslDistro,
			opencodePath: this.settings.opencodePath,
			cwd: this.settings.cwd,
			serverPassword: this.settings.serverPassword,
		});

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new OpencodeView(leaf, this),
		);

		this.addRibbonIcon("terminal", "OpenCode", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "toggle-opencode",
			name: "Toggle OpenCode panel",
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new OpencodeSettingTab(this.app, this));
	}

	onunload(): void {
		this.serverManager.destroy();
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.forEach((leaf) => leaf.detach());
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			void workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		void workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<OpencodeSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private detectWslVaultPath(): string | null {
		try {
			const adapter = this.app.vault.adapter as unknown as { getBasePath(): string };
			const winPath = adapter.getBasePath();
			const match = winPath.match(/^([A-Za-z]):(.*)$/);
			if (!match) return null;
			return `/mnt/${match[1].toLowerCase()}${match[2].replace(/\\/g, "/")}`;
		} catch {
			return null;
		}
	}
}

class OpencodeSettingTab extends PluginSettingTab {
	plugin: OpencodePlugin;

	constructor(app: App, plugin: OpencodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Auto-start server")
			.setDesc("Automatically start the OpenCode server when the panel opens")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStart)
					.onChange(async (value) => {
						this.plugin.settings.autoStart = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Server port")
			.setDesc("Port for the OpenCode server")
			.addText((text) =>
				text
					.setPlaceholder("14096")
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0 && num < 65536) {
							this.plugin.settings.port = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("WSL distribution")
			.setDesc("Leave empty to use the default WSL distribution")
			.addText((text) =>
				text
					.setPlaceholder("Ubuntu")
					.setValue(this.plugin.settings.wslDistro)
					.onChange(async (value) => {
						this.plugin.settings.wslDistro = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("OpenCode path (WSL)")
			.setDesc("Path to the opencode executable inside WSL")
			.addText((text) =>
				text
					.setPlaceholder("opencode")
					.setValue(this.plugin.settings.opencodePath)
					.onChange(async (value) => {
						this.plugin.settings.opencodePath = value || "opencode";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Working directory (WSL path)")
			.setDesc("Working directory inside WSL")
			.addText((text) =>
				text
					.setPlaceholder("/mnt/c/Users/.../my-vault")
					.setValue(this.plugin.settings.cwd)
					.onChange(async (value) => {
						this.plugin.settings.cwd = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Server password")
			.setDesc("OPENCODE_SERVER_PASSWORD (leave empty for no auth)")
			.addText((text) =>
				text
					.setPlaceholder("optional")
					.setValue(this.plugin.settings.serverPassword)
					.onChange(async (value) => {
						this.plugin.settings.serverPassword = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Server").setHeading();

		const status = this.plugin.serverManager?.running ? "running" : "stopped";
		new Setting(containerEl)
			.setName("Status")
			.setDesc(`Server is ${status}`)
			.addButton((btn) =>
				btn
					.setButtonText(this.plugin.serverManager?.running ? "Stop" : "Start")
					.setCta()
					.onClick(async () => {
						if (this.plugin.serverManager?.running) {
							await this.plugin.serverManager.stop();
							new Notice("Server stopped");
						} else {
							const ok = await this.plugin.serverManager.start();
							new Notice(ok ? "Server started" : "Server failed to start");
						}
						this.display();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Restart")
					.onClick(async () => {
						await this.plugin.serverManager.restart();
						new Notice("Server restarted");
						this.display();
					}),
			);
	}
}
