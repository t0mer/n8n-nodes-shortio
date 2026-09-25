import { describe, expect, it, vi } from 'vitest';

import { paginateOffset, paginateToken, paginateTokenFind } from '../shared/pagination';

describe('paginateOffset', () => {
	it('walks pages until a short page, returning all items', async () => {
		const pages = [
			[1, 2],
			[3, 4],
			[5],
		];
		const fetchPage = vi.fn(async (offset: number, pageSize: number) => pages[offset / pageSize] ?? []);

		const items = await paginateOffset(fetchPage, undefined, 2);

		expect(items).toEqual([1, 2, 3, 4, 5]);
		expect(fetchPage).toHaveBeenCalledTimes(3);
	});

	it('trims to the limit and stops fetching early', async () => {
		const pages = [
			[1, 2],
			[3, 4],
			[5, 6],
		];
		const fetchPage = vi.fn(async (offset: number, pageSize: number) => pages[offset / pageSize] ?? []);

		const items = await paginateOffset(fetchPage, 3, 2);

		expect(items).toEqual([1, 2, 3]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('returns an empty array when the first page is empty', async () => {
		const fetchPage = vi.fn(async () => []);

		const items = await paginateOffset(fetchPage, undefined, 2);

		expect(items).toEqual([]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('stops if a page is identical to the previous one, as a loop guard against an offset the endpoint ignores', async () => {
		// A full page every time, offset never actually respected server-side: without a guard this
		// would never see a short page and would loop forever.
		const fetchPage = vi.fn(async () => [1, 2]);

		const items = await paginateOffset(fetchPage, undefined, 2);

		expect(items).toEqual([1, 2]);
		expect(fetchPage).toHaveBeenCalledTimes(2); // one call that returns [1,2], one identical repeat
	});

	it('does not stop early when consecutive full pages merely have the same length but different content', async () => {
		const pages = [
			[1, 2],
			[3, 4],
			[5],
		];
		const fetchPage = vi.fn(async (offset: number, pageSize: number) => pages[offset / pageSize] ?? []);

		const items = await paginateOffset(fetchPage, undefined, 2);

		expect(items).toEqual([1, 2, 3, 4, 5]);
	});

	it('stops at a hard cap of pages even when every page is full and distinct (never-ending pagination)', async () => {
		const fetchPage = vi.fn(async (offset: number) => [offset]); // always length 1 == pageSize, always distinct

		const items = await paginateOffset(fetchPage, undefined, 1);

		expect(fetchPage).toHaveBeenCalledTimes(1000);
		expect(items).toHaveLength(1000);
	});
});

describe('paginateToken', () => {
	it('follows the token until the token is null', async () => {
		const pages: Record<string, { items: number[]; next: string | null }> = {
			start: { items: [1, 2], next: 'page_b' },
			page_b: { items: [3, 4], next: 'page_c' },
			page_c: { items: [5], next: null },
		};
		const fetchPage = vi.fn(async (token: string | undefined) => pages[token ?? 'start']);

		const items = await paginateToken(fetchPage, undefined, 150);

		expect(items).toEqual([1, 2, 3, 4, 5]);
		expect(fetchPage).toHaveBeenCalledTimes(3);
		expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 150);
		expect(fetchPage).toHaveBeenNthCalledWith(2, 'page_b', 150);
		expect(fetchPage).toHaveBeenNthCalledWith(3, 'page_c', 150);
	});

	it('stops once the limit is reached, requesting min(remaining, maxPageSize) per page', async () => {
		const pages: Record<string, { items: number[]; next: string | null }> = {
			start: { items: [1, 2, 3], next: 'page_b' },
			page_b: { items: [4, 5], next: 'page_c' },
			page_c: { items: [6, 7, 8], next: 'page_d' },
		};
		const fetchPage = vi.fn(async (token: string | undefined) => pages[token ?? 'start']);

		const items = await paginateToken(fetchPage, 5, 3);

		expect(items).toEqual([1, 2, 3, 4, 5]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
		expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 3);
		expect(fetchPage).toHaveBeenNthCalledWith(2, 'page_b', 2);
	});

	it('stops on an empty page even when a token comes back, as a loop guard', async () => {
		const fetchPage = vi.fn(async () => ({ items: [] as number[], next: 'page_b' }));

		const items = await paginateToken(fetchPage, undefined, 150);

		expect(items).toEqual([]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('stops if the token repeats, as a loop guard', async () => {
		const pages: Record<string, { items: number[]; next: string | null }> = {
			start: { items: [1], next: 'page_b' },
			page_b: { items: [2], next: 'page_b' },
		};
		const fetchPage = vi.fn(async (token: string | undefined) => pages[token ?? 'start']);

		const items = await paginateToken(fetchPage, undefined, 150);

		expect(items).toEqual([1, 2]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});
});

describe('paginateTokenFind', () => {
	it('always requests the full pageSize, ignoring any caller-side result limit', async () => {
		// The caller may want only a handful of results overall (e.g. a UI "Limit" of 50), but a
		// search still has to scan every page at full size to find its one match.
		const page1 = Array.from({ length: 150 }, (_, i) => i); // no match on page 1
		const pages: Record<string, { items: number[]; next: string | null }> = {
			start: { items: page1, next: 'page_b' },
			page_b: { items: [999], next: null },
		};
		const fetchPage = vi.fn(async (token: string | undefined) => pages[token ?? 'start']);

		const items = await paginateTokenFind(fetchPage, (n) => n === 999, 150);

		expect(items).toEqual([999]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
		expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 150);
		expect(fetchPage).toHaveBeenNthCalledWith(2, 'page_b', 150);
	});

	it('returns as soon as a page matches, without fetching further pages', async () => {
		const fetchPage = vi.fn(async () => ({ items: [1, 2, 3], next: 'more' }));

		const items = await paginateTokenFind(fetchPage, (n) => n === 2, 150);

		expect(items).toEqual([2]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('returns an empty array once pagination is exhausted with no match', async () => {
		const pages: Record<string, { items: number[]; next: string | null }> = {
			start: { items: [1, 2], next: 'page_b' },
			page_b: { items: [3, 4], next: null },
		};
		const fetchPage = vi.fn(async (token: string | undefined) => pages[token ?? 'start']);

		const items = await paginateTokenFind(fetchPage, (n) => n === 999, 150);

		expect(items).toEqual([]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('stops on an empty page, as a loop guard', async () => {
		const fetchPage = vi.fn(async () => ({ items: [] as number[], next: 'page_b' }));

		const items = await paginateTokenFind(fetchPage, (n) => n === 1, 150);

		expect(items).toEqual([]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('stops if the token repeats, as a loop guard', async () => {
		const pages: Record<string, { items: number[]; next: string | null }> = {
			start: { items: [1], next: 'page_b' },
			page_b: { items: [2], next: 'page_b' },
		};
		const fetchPage = vi.fn(async (token: string | undefined) => pages[token ?? 'start']);

		const items = await paginateTokenFind(fetchPage, (n) => n === 999, 150);

		expect(items).toEqual([]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});
});
