import { useEffect, useState } from 'octane';

function publishSelection(value: string): void {
	console.info('octane-r10-background-selection', value);
}

/** Ordinary TypeScript custom-hook boundary shared by both compiler layers. */
export function useBlockSelection(initialValue: string) {
	const [value, setValue] = useState(initialValue);

	useEffect(() => {
		publishSelection(value);
	}, [value]);

	return [value, setValue] as const;
}
