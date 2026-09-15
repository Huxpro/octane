/** Map the current app-owned Native v2 receipt onto the historical #194 runner fields. */
export function normalizeIssue194NativeReceipt(value, interactionOrdinal) {
	const workload = value.name;
	return {
		...value,
		interactionOrdinal,
		workload,
		scale: workload === 'clear' ? value.preState?.rowCount : value.postState?.rowCount,
	};
}
