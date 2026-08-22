// Issue-#135 item 1b — hook cells for a core that is not a universal root.
//
// `useState` and its neighbours reach their cell through two pieces of module
// state in `universal-core.ts`: the render attempt and the owner the claim
// controller resolves. Only `UniversalRootImpl` sets them, so a second core in
// this family — one that owns its own commit protocol — cannot run a compiled
// component's setup, even though the hook functions are already linked into
// its bundle by the application module that calls them.
//
// `createUniversalHookScope` is the seam that lets it. These cases pin what the
// seam promises, and they call the hooks directly with explicit slots rather
// than through a compiled component: the claim is about the cells, and a
// component in the way would make a failure ambiguous between the two.
//
// The scheduling half is the part worth stating twice. An update raised by a
// *committed* setter — a tap handler, a timer — has no render in flight, so it
// schedules. An update raised *during* a render has one, so it does not: it
// folds into the draft cell and the render runs again inside the same attempt
// until it settles. Getting that backwards is an infinite loop in one direction
// and a dropped update in the other, so both have their own case.
import { describe, expect, it } from 'vitest';

import {
	createUniversalHookScope,
	useCallback,
	useMemo,
	useRef,
	useState,
} from 'octane/universal/native';

/** A scope plus the schedule calls it made, which is half of what is asserted. */
function scopeWithLog() {
	const scheduled: number[] = [];
	let renders = 0;
	const scope = createUniversalHookScope({
		renderer: 'test',
		scheduleRender() {
			scheduled.push(renders);
		},
	});
	return {
		scope,
		scheduled,
		/** Render, commit, and hand back what the setup returned. */
		pass<T>(setup: () => T): T {
			renders += 1;
			const value = scope.render(setup);
			scope.commit();
			return value;
		},
	};
}

describe('universal hook scope', () => {
	it('keeps a state cell across renders and schedules when a committed setter writes it', () => {
		const { scope, scheduled, pass } = scopeWithLog();

		let set!: (value: number | ((previous: number) => number)) => void;
		const first = pass(() => {
			const [value, update] = useState(1, 'count');
			set = update;
			return value;
		});
		expect(first).toBe(1);
		expect(scheduled).toEqual([]);

		// No render is in flight, so this is the committed path: the update is
		// queued and the core is asked to render again.
		//
		// A functional updater rather than a value, deliberately: replaying a
		// plain `set(2)` lands on 2 again, so a commit that failed to drain the
		// queue would be indistinguishable from one that drained it.
		set((previous) => previous + 1);
		expect(scheduled).toEqual([1]);

		expect(pass(() => useState(1, 'count')[0])).toBe(2);

		// The queue drained on commit, so a third render re-reads the cell
		// rather than folding the increment into it a second time.
		expect(pass(() => useState(1, 'count')[0])).toBe(2);
		expect(scheduled).toEqual([1]);
		scope.dispose();
	});

	it('folds an update raised during a render into that render instead of scheduling', () => {
		const { scope, scheduled } = scopeWithLog();

		const seen: number[] = [];
		scope.render(() => {
			const [value, update] = useState(0, 'count');
			seen.push(value);
			// Raised while this render is in flight: there is a draft cell to
			// write, so it settles inside this attempt rather than scheduling.
			if (value === 0) update(7);
		});
		expect(seen).toEqual([0, 7]);
		expect(scheduled).toEqual([]);
		scope.commit();

		// And the settled value is what was published, not the initial one.
		expect(scope.render(() => useState(0, 'count')[0])).toBe(7);
		expect(scheduled).toEqual([]);
		scope.dispose();
	});

	it('caps a setup that writes its own state forever instead of hanging', () => {
		const { scope } = scopeWithLog();
		expect(() =>
			scope.render(() => {
				const [value, update] = useState(0, 'count');
				update(value + 1);
			}),
		).toThrow(/Too many universal render-phase updates/);
		scope.dispose();
	});

	it('schedules nothing when a committed setter writes the value already there', () => {
		const { scope, scheduled, pass } = scopeWithLog();
		let set!: (value: number) => void;
		pass(() => {
			const [, update] = useState(3, 'count');
			set = update;
		});

		set(3);
		expect(scheduled).toEqual([]);

		set(4);
		expect(scheduled).toEqual([1]);
		scope.dispose();
	});

	it('holds memo and ref cells across renders on the same terms as a root', () => {
		const { scope, pass } = scopeWithLog();

		const computed: number[] = [];
		const render = (dep: number) =>
			pass(() => {
				const memo = useMemo(
					() => {
						computed.push(dep);
						return { dep };
					},
					[dep],
					'memo',
				);
				const callback = useCallback(() => dep, [dep], 'callback');
				const ref = useRef(0, 'ref');
				ref.current += 1;
				return { memo, callback, ref };
			});

		const a = render(1);
		const b = render(1);
		expect(computed).toEqual([1]);
		expect(b.memo).toBe(a.memo);
		expect(b.callback).toBe(a.callback);
		// One ref cell, written twice — not two cells written once.
		expect(b.ref.current).toBe(2);

		const c = render(2);
		expect(computed).toEqual([1, 2]);
		expect(c.memo).not.toBe(a.memo);
		expect(c.ref.current).toBe(3);
		scope.dispose();
	});

	it('leaves the committed cells alone when a render is aborted', () => {
		const { scope, pass } = scopeWithLog();
		pass(() => useState(1, 'count'));

		expect(
			scope.render(() => {
				const [, update] = useState(1, 'count');
				update(9);
				return useState(1, 'count')[0];
			}),
		).toBe(9);
		scope.abort();

		// That render settled on 9 in its draft. Committing nothing means the
		// next render starts from the published cell, not from the draft.
		expect(pass(() => useState(1, 'count')[0])).toBe(1);
		scope.dispose();
	});

	it('ignores a setter that fires after the scope is disposed', () => {
		const { scope, scheduled, pass } = scopeWithLog();
		let set!: (value: number) => void;
		pass(() => {
			const [, update] = useState(0, 'count');
			set = update;
		});

		scope.dispose();
		set(5);
		expect(scheduled).toEqual([]);
		expect(() => scope.render(() => undefined)).toThrow(/disposed/);
	});

	it('refuses a second render while one is in flight', () => {
		const { scope } = scopeWithLog();
		const other = createUniversalHookScope({ renderer: 'test', scheduleRender() {} });
		expect(() =>
			scope.render(() => {
				other.render(() => undefined);
			}),
		).toThrow(/already in flight/);
		// The failed nesting must not strand the outer scope's attempt.
		expect(() => scope.render(() => useState(0, 'count')[0])).not.toThrow();
		scope.dispose();
		other.dispose();
	});
});
