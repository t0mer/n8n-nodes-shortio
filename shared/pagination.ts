/**
 * Walks an offset-paginated endpoint, calling `fetchPage(offset, pageSize)` until a page comes
 * back shorter than `pageSize` (the last page) or `limit` has been reached, then trims the
 * combined results to `limit`. `limit` of `undefined` fetches everything.
 */
export async function paginateOffset<T>(
	fetchPage: (offset: number, pageSize: number) => Promise<T[]>,
	limit: number | undefined,
	pageSize: number,
): Promise<T[]> {
	const items: T[] = [];
	let offset = 0;

	for (;;) {
		const page = await fetchPage(offset, pageSize);
		items.push(...page);

		if (page.length < pageSize) break;
		if (limit !== undefined && items.length >= limit) break;

		offset += pageSize;
	}

	return limit !== undefined ? items.slice(0, limit) : items;
}
