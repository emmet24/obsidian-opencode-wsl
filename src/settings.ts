export interface OpencodeSettings {
	port: number;
	hostname: string;
	autoStart: boolean;
	wslDistro: string;
	opencodePath: string;
	cwd: string;
	serverPassword: string;
}

export const DEFAULT_SETTINGS: OpencodeSettings = {
	port: 14096,
	hostname: "127.0.0.1",
	autoStart: true,
	wslDistro: "",
	opencodePath: "opencode",
	cwd: "",
	serverPassword: "",
};
