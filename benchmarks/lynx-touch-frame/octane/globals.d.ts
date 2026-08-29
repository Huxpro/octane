declare const __BENCH_TOPOLOGY__: 'T2' | 'T3';
declare const __BENCH_LOAD__: 'idle' | 'sustained-scroll';
declare const __BENCH_PROFILE__: boolean;

declare function __AddInlineStyle(node: object, name: string, value: string): void;
declare function __FlushElementTree(node?: object): void;
declare function __GetAttributeByName(node: object, name: string): unknown;
declare function __GetComputedStyleByKey(node: object, name: string): string;
declare function __QuerySelector(
	node: object,
	selector: string,
	options: Readonly<Record<string, unknown>>,
): object | null;
declare function __RemoveElement(parent: object, child: object): void;
declare function __SetAttribute(node: object, name: string, value: unknown): void;

interface Issue197TouchEvent {
	timestamp: number;
	target: { id: string };
}

declare const lynx: {
	performance: {
		profileMark(
			name: string,
			options?: Readonly<{ args?: Readonly<Record<string, string>> }>,
		): void;
	};
};
