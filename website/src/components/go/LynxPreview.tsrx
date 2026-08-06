// The Octane binding over ./lynx-view.
//
// Everything about actually running a Lynx bundle — creating the element,
// ordering `browserConfig` before `url`, the fit/responsive viewport decision,
// and working out whether the page has painted — lives in ./lynx-view, which is
// an adaptation of @lynx-js/go-web's own logic and has no framework in it (see
// ./lynx-view/UPSTREAM.md). This file is only a host element, an effect, and
// the site's own loading and error treatment.
import { useEffect, useRef, useState } from 'octane';
import { loadLynxRuntime } from './lynx-runtime.ts';
import { mountLynxView, type LynxViewState, type WebPreviewMode } from './lynx-view/index.ts';

interface LynxPreviewProps {
	/** Absolute or root-relative URL of the `.web.bundle` to mount. */
	src: string;
	/** Names the preview for assistive technology. */
	label: string;
	/**
 * How the example fills the panel. `responsive` re-bases `rpx`/`vw`/`vh` onto
 * the panel so the example lays itself out for it; `fit` keeps the authored
 * phone viewport and scales it; `auto` picks per container size.
 */
	mode?: WebPreviewMode;
}

const STAGE_LABELS = {
	runtime: 'Starting the Lynx runtime…',
	downloading: 'Loading the example…',
	rendering: 'Rendering…',
	rendered: '',
};

export function LynxPreview(props: LynxPreviewProps) @{
	const host = useRef<HTMLDivElement | null>(null);
	const [state, setState] = useState<LynxViewState>({
		ready: false,
		rendered: false,
		stage: 'runtime',
		error: null,
	});

	useEffect(() => {
		const container = host.current;
		if (!container) return;
		const view = mountLynxView(container, {
			url: props.src,
			loadRuntime: loadLynxRuntime,
			webPreviewMode: props.mode ?? 'auto',
			onStateChange: setState,
		});
		return () => view.dispose();
	});

	<div class="lynx-preview" data-rendered={state.rendered}>
		<div class="lynx-preview-host" ref={host} role="figure" aria-label={props.label}></div>
		@if (state.error) {
			<p class="lynx-preview-note lynx-preview-error" role="status">
				{'The preview could not start. ' + state.error}
			</p>
		} @else if (!state.rendered) {
			<p class="lynx-preview-note" role="status">{STAGE_LABELS[state.stage]}</p>
		}

		<style>
			.lynx-preview {
				position: relative;
				width: 100%;
				height: 100%;
				background: #0d0f13;
			}
			/* The controller measures this element, so it needs a definite size of
			   its own and owns everything below it. */
			.lynx-preview-host {
				width: 100%;
				height: 100%;
				opacity: 0;
				transition: opacity 0.2s ease;
			}
			/* Hold the preview back until the page paints, so a reader never sees
			   the runtime assembling itself. */
			.lynx-preview[data-rendered='true'] .lynx-preview-host {
				opacity: 1;
			}
			.lynx-preview-note {
				position: absolute;
				inset: auto 1rem 1rem;
				margin: 0;
				color: var(--text-secondary);
				font-size: 0.8rem;
				text-align: center;
			}
			.lynx-preview-error {
				inset: 1rem;
				display: grid;
				place-content: center;
				color: var(--danger-text);
				line-height: 1.5;
			}
			@media (prefers-reduced-motion: reduce) {
				.lynx-preview-host {
					transition: none;
				}
			}
		</style>
	</div>
}
