// <Go> — a packaged Lynx example, side by side with a live preview of it.
//
// The name and the data layout come from @lynx-js/go-web, the community
// component that does this for Lynx sites: an example is a directory of
// sources plus an `example-metadata.json` naming its bundles, and the site
// mounts the Lynx-for-Web bundle in a `<lynx-view>`. This is that contract in
// Octane, with the site's own chrome — go-web is a React component, and this
// site has no React in it.
//
// The preview costs a runtime download and, for an image-heavy example, a few
// megabytes of assets, so nothing loads until the panel comes into view. The
// Web and Device tabs then both stay mounted: switching to the QR code and
// back should not restart the example.
import { useEffect, useRef, useState } from 'octane';
import { bundleUrl, loadExample, resolveEntry, type LoadedExample } from './example-data.ts';
import { DeviceScan } from './DeviceScan.tsrx';
import { LynxPreview } from './LynxPreview.tsrx';
import type { WebPreviewMode } from './lynx-view/index.ts';

// Start fetching a screen before the panel arrives, so scrolling to it usually
// finds it already running.
const PRELOAD_MARGIN = '400px';

interface GoProps {
	/** Example id — the folder name under `/lynx-examples`. */
	example: string;
	/** Entry to preview; defaults to the first one in the metadata. */
	entry?: string;
	/** Source file to open on; defaults to the packaged `defaultFile`. */
	file?: string;
	/** Names the panel for assistive technology. */
	label: string;
	/** Viewport handling for the web preview. See LynxPreview. */
	mode?: WebPreviewMode;
}

export function Go(props: GoProps) @{
	const panel = useRef<HTMLDivElement | null>(null);
	const [near, setNear] = useState(false);
	const [loaded, setLoaded] = useState<LoadedExample | null>(null);
	const [error, setError] = useState('');
	const [openFile, setOpenFile] = useState('');
	const [tab, setTab] = useState<'web' | 'device'>('web');

	// Everything below — metadata, sources, the Lynx runtime, the example's own
	// assets — waits on this.
	useEffect(() => {
		const element = panel.current;
		if (!element || near) return;
		if (typeof IntersectionObserver === 'undefined') {
			setNear(true);
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setNear(true);
				observer.disconnect();
			}
		}, { rootMargin: PRELOAD_MARGIN });
		observer.observe(element);
		return () => observer.disconnect();
	});

	useEffect(() => {
		if (!near) return;
		const controller = new AbortController();
		loadExample(props.example, controller.signal).then(
			(next) => {
				setLoaded(next);
				setOpenFile(props.file ?? next.source.defaultFile);
			},
			(reason: Error) => {
				if (reason.name !== 'AbortError') setError(reason.message);
			},
		);
		return () => controller.abort();
	});

	const entry =
		loaded ? resolveEntry(loaded.metadata, props.entry) : undefined;
	const sources = loaded?.source.files ?? [];
	const current = sources.find(({ path }) => path === openFile) ?? sources[0];
	const webBundle = entry?.webFile;
	const nativeBundle = entry?.file;

	<div class="go" ref={panel}>
		<div class="go-body">
			<div class="go-code">
				<div class="go-files" role="tablist" aria-label="Example source files">
					@for (const source of sources; key source.path) {
						<button
							type="button"
							role="tab"
							class={['go-file', source.path === current?.path && 'is-open']}
							aria-selected={source.path === current?.path}
							title={source.path}
							onClick={() => setOpenFile(source.path)}
						>{fileLabel(source.path) as string}</button>
					}
				</div>
				<div class="go-source">
					@if (current) {
						<div class="go-source-code" dangerouslySetInnerHTML={{ __html: current.html }}></div>
					} @else if (error) {
						<p class="go-message go-message-error">
							{'This example could not be loaded. ' + error}
						</p>
					} @else {
						<p class="go-message">Loading the example…</p>
					}
				</div>
			</div>

			<div class="go-preview">
				<div class="go-preview-tabs" role="tablist" aria-label="Preview target">
					<button
						type="button"
						role="tab"
						class={['go-tab', tab === 'web' && 'is-active']}
						aria-selected={tab === 'web'}
						onClick={() => setTab('web')}
					>Web</button>
					<button
						type="button"
						role="tab"
						class={['go-tab', tab === 'device' && 'is-active']}
						aria-selected={tab === 'device'}
						onClick={() => setTab('device')}
					>Device</button>
				</div>
				<div class="go-preview-body">
					{/* Both panes stay mounted: unmounting the web preview to show a
    QR code would restart the example on every tab switch. */}
					<div class="go-pane" hidden={tab !== 'web'}>
						@if (near && webBundle) {
							<LynxPreview
								src={`/lynx-examples/${props.example}/${webBundle}`}
								label={props.label}
								mode={props.mode}
							/>
						} @else if (near && loaded) {
							<p class="go-message">
								This example was not built for the web. Use the Device tab to run it.
							</p>
						}
					</div>
					<div class="go-pane" hidden={tab !== 'device'}>
						@if (near && nativeBundle) {
							<DeviceScan url={bundleUrl(props.example, nativeBundle)} />
						}
					</div>
				</div>
			</div>
		</div>

		<style>
			/* The site's code-panel frame, widened into two columns. */
			.go {
				margin: 1.6rem 0;
				border: 1px solid var(--border);
				border-radius: 1rem;
				overflow: hidden;
				background: var(--code-bg);
			}
			.go-body {
				display: grid;
				grid-template-columns: minmax(0, 1fr) 15.5rem;
				min-height: 0;
			}
			.go-code {
				display: flex;
				flex-direction: column;
				min-width: 0;
				border-right: 1px solid var(--border);
			}
			/* Editor-style file strip. It scrolls horizontally rather than wrapping,
			   so the panel's height does not change with the file count. */
			.go-files {
				display: flex;
				gap: 0.15rem;
				min-height: 2rem;
				padding: 0 0.35rem;
				overflow-x: auto;
				scrollbar-width: none;
				background: var(--surface-subtle);
				border-bottom: 1px solid var(--border);
			}
			.go-files::-webkit-scrollbar {
				display: none;
			}
			.go-file {
				flex: none;
				padding: 0 0.5rem;
				border: 0;
				border-bottom: 2px solid transparent;
				background: transparent;
				color: var(--text-secondary);
				font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, Consolas, monospace;
				font-size: 0.72rem;
				white-space: nowrap;
				cursor: pointer;
				transition:
					color 0.15s,
					border-color 0.15s;
			}
			.go-file:hover {
				color: var(--text);
			}
			.go-file.is-open {
				color: var(--text);
				border-bottom-color: var(--accent);
			}
			/* The panel's preview column is proportioned to the 375 x 812 viewport
			   these examples are authored for, so the auto-fit path resolves to
			   roughly the same scale on both axes and nothing is cropped. Keep the
			   two heights in step if either changes. */
			.go-source {
				min-height: 0;
				height: 33.5rem;
				overflow: auto;
				scrollbar-width: thin;
			}
			/* Shiki brings its own frame; flatten it into the panel the way the
			   docs' CodeBlock does. */
			.go-source-code :global(pre.shiki) {
				margin: 0;
				border: none;
				border-radius: 0;
				padding: 0.85rem 1rem;
				font-size: 0.75rem;
				line-height: 1.6;
			}
			.go-preview {
				display: flex;
				flex-direction: column;
				min-width: 0;
			}
			.go-preview-tabs {
				display: flex;
				gap: 0.15rem;
				min-height: 2rem;
				padding: 0 0.35rem;
				background: var(--surface-subtle);
				border-bottom: 1px solid var(--border);
			}
			.go-tab {
				padding: 0 0.6rem;
				border: 0;
				border-bottom: 2px solid transparent;
				background: transparent;
				color: var(--text-secondary);
				font: inherit;
				font-size: 0.75rem;
				font-weight: 600;
				cursor: pointer;
				transition:
					color 0.15s,
					border-color 0.15s;
			}
			.go-tab:hover {
				color: var(--text);
			}
			.go-tab.is-active {
				color: var(--text);
				border-bottom-color: var(--accent);
			}
			/* The container both panes measure against: the preview scales a
			   375 x 812 phone into it, and the QR code sizes off it. */
			.go-preview-body {
				position: relative;
				container-type: size;
				height: 33.5rem;
			}
			.go-pane {
				position: absolute;
				inset: 0;
			}
			.go-pane[hidden] {
				display: none;
			}
			.go-message {
				display: grid;
				place-content: center;
				height: 100%;
				margin: 0;
				padding: 1.5rem;
				color: var(--text-secondary);
				font-size: 0.82rem;
				line-height: 1.5;
				text-align: center;
			}
			.go-message-error {
				color: var(--danger-text);
			}
			/* Below the two-column breakpoint the preview leads: it is the thing
			   worth looking at, and the code reads fine underneath it. */
			@media (max-width: 640px) {
				.go-body {
					grid-template-columns: minmax(0, 1fr);
				}
				.go-code {
					order: 2;
					border-right: 0;
					border-top: 1px solid var(--border);
				}
				.go-preview {
					order: 1;
				}
				.go-source {
					height: 20rem;
				}
			}
		</style>
	</div>
}

/**
 * The shortest label that still identifies a file in the strip. Sources live
 * under `src/`, so the directory adds nothing; anything nested keeps its parent
 * so `pictures/furnituresPictures.ts` does not read as a root file.
 */
function fileLabel(path: string): string {
	const parts = path.split('/');
	if (parts.length <= 1) return path;
	if (parts[0] === 'src') return parts.slice(1).join('/');
	return parts.join('/');
}
