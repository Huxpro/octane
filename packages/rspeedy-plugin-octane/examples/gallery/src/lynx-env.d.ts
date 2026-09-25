/**
 * Lynx runtime globals used by this example. `SystemInfo` exists in both Lynx
 * runtimes; element operations use the public LynxMainThreadElement wrapper.
 */
declare const SystemInfo: {
	readonly pixelWidth: number;
	readonly pixelHeight: number;
	readonly pixelRatio: number;
	readonly platform: string;
};
