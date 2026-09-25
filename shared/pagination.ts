/** Hard cap on the number of pages {@link paginateOffset} will ever fetch, regardless of `limit` —
 * a last-resort backstop against an endpoint that never returns a short page (offset silently
 * ignored server-side, or similar), independent of the same-page loop guard below. */
const MAX_OFFSET_PAGES = 1000;

/**
 * Walks an offset-paginated endpoint, calling `fetchPage(offset, pageSize)` until a page comes
 * back shorter than `pageSize` (the last page) or `limit` has been reached, then trims the
 * combined results to `limit`. `limit` of `undefined` fetches everything.
 *
 * Two loop guards protect against an endpoint that doesn't actually respect `offset` (returning
 * the same full page forever, which would otherwise loop until memory/timeout limits are hit):
 * a page that is exactly identical (same length and content) to the immediately preceding one
 * stops the walk — offset-based pagination making no progress is never valid, unlike a token
 * walk's transient repeat — and a hard cap of {@link MAX_OFFSET_PAGES} pages stops it regardless.
 */
export async function paginateOffset<T>(
	fetchPage: (offset: number, pageSize: number) => Promise<T[]>,
	limit: number | undefined,
	pageSize: number,
): Promise<T[]> {
	const items: T[] = [];
	let offset = 0;
	let previousPageJson: string | undefined;

	for (let pageCount = 0; pageCount < MAX_OFFSET_PAGES; pageCount++) {
		const page = await fetchPage(offset, pageSize);

		const pageJson = JSON.stringify(page);
		if (pageJson === previousPageJson) break;
		previousPageJson = pageJson;

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
 * server-side filter doesn't work, the caller fetches unfiltered pages and matches client-side.
 *
 * There is no `limit`: a search ignores the caller's own result limit for scan depth, since a
 * match beyond it is still the one match being looked for. Every page requests the full
 * `pageSize`, and the walk is bounded only by the same loop guards as `paginateToken` (an empty
 * page, or a `next` token that repeats one already used).
 */
export async function paginateTokenFind<T>(
	fetchPage: (
		token: string | undefined,
		pageSize: number,
	) => Promise<{ items: T[]; next?: string | null }>,
	predicate: (item: T) => boolean,
	pageSize: number,
): Promise<T[]> {
	const seenTokens = new Set<string>();
	let token: string | undefined;

	for (;;) {
		const page = await fetchPage(token, pageSize);
		const match = page.items.find(predicate);
		if (match !== undefined) return [match];

		if (page.items.length === 0) break;

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
