declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

interface LynxMainThreadElementGlobals<Node extends object> {
	__SetAttribute(node: Node, name: string, value: unknown): void;
	__AddInlineStyle(node: Node, name: string, value: string): void;
	__GetAttributeByName(node: Node, name: string): unknown;
	__GetAttributeNames(node: Node): string[];
	__QuerySelector(
		node: Node,
		selector: string,
		options: Readonly<Record<string, unknown>>,
	): Node | null;
	__QuerySelectorAll(
		node: Node,
		selector: string,
		options: Readonly<Record<string, unknown>>,
	): Node[];
	__GetComputedStyleByKey(node: Node, name: string): string;
	__InvokeUIMethod(
		node: Node,
		method: string,
		params: Readonly<Record<string, unknown>>,
		callback: (result: { readonly code: number; readonly data?: unknown }) => void,
	): void;
	__ElementAnimate(node: Node, operation: readonly unknown[]): void;
	__FlushElementTree(): void;
}

type LynxMainThreadKeyframe = Readonly<Record<string, number | string>>;
type LynxMainThreadAnimationOptions = Readonly<Record<string, number | string>>;

const enum LynxMainThreadAnimationOperation {
	Start = 0,
	Play = 1,
	Pause = 2,
	Cancel = 3,
}

let animationCount = 0;

let flushScheduled = false;

function required<Node extends object, Name extends keyof LynxMainThreadElementGlobals<Node>>(
	target: object,
	name: Name,
): LynxMainThreadElementGlobals<Node>[Name] {
	const value = (target as Record<PropertyKey, unknown>)[name];
	if (typeof value !== 'function') {
		throw new Error(
			typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
				? `Octane Lynx MainThread.Element requires ${String(name)}.`
				: 'Octane Lynx OL515',
		);
	}
	return value.bind(target) as LynxMainThreadElementGlobals<Node>[Name];
}

function scheduleFlush<Node extends object>(target: object): void {
	if (flushScheduled) return;
	flushScheduled = true;
	void Promise.resolve().then(() => {
		flushScheduled = false;
		required<Node, '__FlushElementTree'>(target, '__FlushElementTree')();
	});
}

/** Public Lynx MainThread.Element surface around one opaque Element PAPI handle. */
export class LynxMainThreadElement<Node extends object = object> {
	declare private readonly element: Node;
	declare private readonly target: object;

	constructor(element: Node, target: object = globalThis) {
		Object.defineProperties(this, {
			element: {
				get() {
					return element;
				},
			},
			target: {
				get() {
					return target;
				},
			},
		});
	}

	setAttribute(name: string, value: unknown): void {
		required<Node, '__SetAttribute'>(this.target, '__SetAttribute')(this.element, name, value);
		scheduleFlush<Node>(this.target);
	}

	setStyleProperty(name: string, value: string): void {
		required<Node, '__AddInlineStyle'>(this.target, '__AddInlineStyle')(this.element, name, value);
		scheduleFlush<Node>(this.target);
	}

	setStyleProperties(styles: Readonly<Record<string, string>>): void {
		const set = required<Node, '__AddInlineStyle'>(this.target, '__AddInlineStyle');
		for (const name of Object.keys(styles)) set(this.element, name, styles[name]!);
		scheduleFlush<Node>(this.target);
	}

	getAttribute(name: string): unknown {
		return required<Node, '__GetAttributeByName'>(this.target, '__GetAttributeByName')(
			this.element,
			name,
		);
	}

	getAttributeNames(): string[] {
		return required<Node, '__GetAttributeNames'>(this.target, '__GetAttributeNames')(this.element);
	}

	querySelector(selector: string): LynxMainThreadElement<Node> | null {
		const node = required<Node, '__QuerySelector'>(this.target, '__QuerySelector')(
			this.element,
			selector,
			{},
		);
		return node === null ? null : new LynxMainThreadElement(node, this.target);
	}

	querySelectorAll(selector: string): LynxMainThreadElement<Node>[] {
		return required<Node, '__QuerySelectorAll'>(this.target, '__QuerySelectorAll')(
			this.element,
			selector,
			{},
		).map((node) => new LynxMainThreadElement(node, this.target));
	}

	getComputedStyleProperty(name: string): string {
		if (name.length === 0) throw new TypeError('MainThread.Element style name must not be empty.');
		return required<Node, '__GetComputedStyleByKey'>(this.target, '__GetComputedStyleByKey')(
			this.element,
			name,
		);
	}

	animate(
		keyframes: readonly LynxMainThreadKeyframe[],
		options: number | LynxMainThreadAnimationOptions = {},
	): LynxMainThreadAnimation<Node> {
		return new LynxMainThreadAnimation(
			this.element,
			this,
			keyframes,
			typeof options === 'number' ? { duration: options } : options,
			this.target,
		);
	}

	invoke(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
		return new Promise((resolve, reject) => {
			required<Node, '__InvokeUIMethod'>(this.target, '__InvokeUIMethod')(
				this.element,
				method,
				params,
				(result) => {
					if (result.code === 0) resolve(result.data);
					else reject(new Error('UI method invoke: ' + JSON.stringify(result)));
				},
			);
			scheduleFlush<Node>(this.target);
		});
	}
}

/** Main-thread animation handle backed by Lynx's Element PAPI. */
export class LynxMainThreadAnimation<Node extends object = object> {
	readonly id = '__lynx-inner-js-animation-' + animationCount++;
	readonly effect: {
		readonly target: LynxMainThreadElement<Node>;
		readonly keyframes: readonly LynxMainThreadKeyframe[];
		readonly options: LynxMainThreadAnimationOptions;
	};
	declare private readonly element: Node;
	declare private readonly globals: object;

	constructor(
		element: Node,
		target: LynxMainThreadElement<Node>,
		keyframes: readonly LynxMainThreadKeyframe[],
		options: LynxMainThreadAnimationOptions,
		globals: object,
	) {
		Object.defineProperties(this, {
			element: {
				get() {
					return element;
				},
			},
			globals: {
				get() {
					return globals;
				},
			},
		});
		this.effect = { target, keyframes, options };
		this.operate(LynxMainThreadAnimationOperation.Start, keyframes, options);
	}

	cancel(): void {
		this.operate(LynxMainThreadAnimationOperation.Cancel);
	}

	pause(): void {
		this.operate(LynxMainThreadAnimationOperation.Pause);
	}

	play(): void {
		this.operate(LynxMainThreadAnimationOperation.Play);
	}

	private operate(operation: LynxMainThreadAnimationOperation, ...args: readonly unknown[]): void {
		required<Node, '__ElementAnimate'>(this.globals, '__ElementAnimate')(this.element, [
			operation,
			this.id,
			...args,
		]);
	}
}

export function createLynxMainThreadElement<Node extends object>(
	node: Node,
	target: object = globalThis,
): LynxMainThreadElement<Node> {
	return new LynxMainThreadElement(node, target);
}
