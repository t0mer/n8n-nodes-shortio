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

/**
 * Like {@link paginateToken}, but stops as soon as `predicate` matches an item on a page, returning
 * just that item (or an empty array if pagination is exhausted first). For endpoints whose
 * server-side filter doesn't work, the caller fetches unfiltered pages and matches client-side;
 * this walks pages using the same `limit`/`maxPageSize` and loop guards as `paginateToken`, without
 * collecting every item into memory.
 */
export async function paginateTokenFind<T>(
	fetchPage: (
		token: string | undefined,
		pageSize: number,
	) => Promise<{ items: T[]; next?: string | null }>,
	predicate: (item: T) => boolean,
	limit: number | undefined,
	maxPageSize: number,
): Promise<T[]> {
	const seenTokens = new Set<string>();
	let token: string | undefined;
	let fetched = 0;

	for (;;) {
		const remaining = limit !== undefined ? limit - fetched : undefined;
		if (remaining !== undefined && remaining <= 0) break;
		const pageSize = remaining !== undefined ? Math.min(remaining, maxPageSize) : maxPageSize;

		const page = await fetchPage(token, pageSize);
		const match = page.items.find(predicate);
		if (match !== undefined) return [match];

		fetched += page.items.length;

		if (page.items.length === 0) break;
		if (limit !== undefined && fetched >= limit) break;

		const next = page.next ?? undefined;
		if (next === undefined) break;
		if (seenTokens.has(next)) break;

		seenTokens.add(next);
		token = next;
	}

	return [];
}

/**
 * Walks a token-paginated endpoint, calling `fetchPage(token, pageSize)` until the response's
 * `next` token is missing, until `limit` items have been collected, or until a loop guard trips
 * (an empty page, or a `next` token that repeats one already used). `limit` of `undefined` fetches
 * everything. Each page requests `min(remaining, maxPageSize)` items when `limit` is set.
 */
export async function paginateToken<T>(
	fetchPage: (
		token: string | undefined,
		pageSize: number,
	) => Promise<{ items: T[]; next?: string | null }>,
	limit: number | undefined,
	maxPageSize: number,
): Promise<T[]> {
	const items: T[] = [];
	const seenTokens = new Set<string>();
	let token: string | undefined;

	for (;;) {
		const remaining = limit !== undefined ? limit - items.length : undefined;
		const pageSize = remaining !== undefined ? Math.min(remaining, maxPageSize) : maxPageSize;

		const page = await fetchPage(token, pageSize);
		items.push(...page.items);

		if (page.items.length === 0) break;
		if (limit !== undefined && items.length >= limit) break;

		const next = page.next ?? undefined;
		if (next === undefined) break;
		if (seenTokens.has(next)) break;

		seenTokens.add(next);
		token = next;
	}

	return limit !== undefined ? items.slice(0, limit) : items;
}
