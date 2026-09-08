declare module 'octane/jsx-runtime' {
	namespace Octane {
		interface SVGAttributes<T> {
			bindtouchstart?: (event: Issue197TouchEvent) => unknown;
		}
	}
}

export {};
