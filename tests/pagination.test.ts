import { describe, expect, it, vi } from 'vitest';

import { paginateOffset } from '../shared/pagination';

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
});
