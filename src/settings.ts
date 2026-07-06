export interface OpencodeWslSettings {
	bridgePort: number;
	fontSize: number;
	fontFamily: string;
	cwd: string;
	wslDistro: string;
	reconnectDelay: number;
	scrollback: number;
	nodeCommand: string;
}

export const DEFAULT_SETTINGS: OpencodeWslSettings = {
	bridgePort: 8765,
	fontSize: 14,
	fontFamily: "'MesloLGS NF', 'JetBrains Mono', 'Fira Code', monospace",
	cwd: "",
	wslDistro: "",
	reconnectDelay: 2000,
	scrollback: 10000,
	nodeCommand: "node",
};