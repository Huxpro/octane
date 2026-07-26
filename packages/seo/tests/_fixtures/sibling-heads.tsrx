import { useState } from 'octane';
import { Head, Title } from '@octanejs/seo';

/** A conditionally rendered child that wants to retitle the page. */
function TabPanel() @{
	<Head>
		<>
			<Title text="ZZZ" />
			<section>tab</section>
		</>
	</Head>
}

/**
 * The arrangement to watch: A's <Head> wraps ONLY its own tags, and <TabPanel />
 * is rendered after it as a SIBLING, not inside it.
 */
export function SiblingHeads() @{
	const [open, setOpen] = useState(false);
	<>
		<Head>
			<Title text="XYZ" />
		</Head>
		<button id="toggle" onClick={() => setOpen(!open)}>toggle</button>
		@if (open) {
			<TabPanel />
		}
	</>
}

/** The same intent written so B's <Head> is nested inside A's. */
export function NestedHeads() @{
	const [open, setOpen] = useState(false);
	<Head>
		<>
			<Title text="XYZ" />
			<button id="toggle" onClick={() => setOpen(!open)}>toggle</button>
			@if (open) {
				<TabPanel />
			}
		</>
	</Head>
}
