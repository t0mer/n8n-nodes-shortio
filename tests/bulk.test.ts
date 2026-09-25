import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sleep } from 'n8n-workflow';
import {
	chunk,
	forEachChunk,
	mapCreateManyResults,
	uniformChunkResult,
} from '../shared/bulk';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

beforeEach(() => {
	vi.mocked(sleep).mockClear();
});

describe('chunk', () => {
	it('throws for a non-positive or non-integer size', () => {
		expect(() => chunk([1, 2, 3], 0)).toThrow('Chunk size must be a positive integer');
		expect(() => chunk([1, 2, 3], -1)).toThrow('Chunk size must be a positive integer');
		expect(() => chunk([1, 2, 3], 1.5)).toThrow('Chunk size must be a positive integer');
	});

	it('returns one chunk per item for size 1', () => {
		expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
	});

	it('splits an exact multiple evenly', () => {
		expect(chunk([1, 2, 3, 4], 2)).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	it('puts the remainder in a shorter final chunk', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});
});

describe('forEachChunk', () => {
	it('sleeps minIntervalMs between chunks, never before the first', async () => {
		const fn = vi.fn(async (c: number[]) => c.reduce((a, b) => a + b, 0));
		const results = await forEachChunk([1, 2, 3, 4, 5], { size: 2, minIntervalMs: 500 }, fn);

		expect(results).toEqual([3, 7, 5]);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(500);
		expect(fn).toHaveBeenNthCalledWith(1, [1, 2], 0);
		expect(fn).toHaveBeenNthCalledWith(2, [3, 4], 1);
		expect(fn).toHaveBeenNthCalledWith(3, [5], 2);
	});

	it('never sleeps when minIntervalMs is 0, even across several chunks', async () => {
		const fn = vi.fn(async () => undefined);
		await forEachChunk([1, 2, 3, 4], { size: 1, minIntervalMs: 0 }, fn);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('never sleeps for a single chunk', async () => {
		const fn = vi.fn(async () => undefined);
		await forEachChunk([1, 2], { size: 10, minIntervalMs: 500 }, fn);
		expect(sleep).not.toHaveBeenCalled();
	});
});

describe('mapCreateManyResults', () => {
	it('maps a mixed array of successes and failures back to their input indices', () => {
		const results = [
			{ idString: 'lnk_a', success: true },
			{ success: false, error: 'bad' },
			{ idString: 'lnk_c', success: true },
		];

		const { ok, failed } = mapCreateManyResults([4, 5, 6], results);

		expect(ok).toEqual([
			{ index: 4, json: results[0] },
			{ index: 6, json: results[2] },
		]);
		expect(failed).toEqual([{ index: 5, message: 'bad' }]);
	});

	it('marks indices with no matching result as failed', () => {
		const results = [{ idString: 'lnk_a', success: true }];

		const { ok, failed } = mapCreateManyResults([10, 11, 12], results);

		expect(ok).toEqual([{ index: 10, json: results[0] }]);
		expect(failed).toEqual([
			{ index: 11, message: 'No result returned for this item' },
			{ index: 12, message: 'No result returned for this item' },
		]);
	});

	it('ignores results beyond the number of indices', () => {
		const results = [
			{ idString: 'lnk_a', success: true },
			{ idString: 'lnk_b', success: true },
			{ idString: 'lnk_c', success: true },
		];

		const { ok, failed } = mapCreateManyResults([0], results);

		expect(ok).toEqual([{ index: 0, json: results[0] }]);
		expect(failed).toEqual([]);
	});

	it('takes the message from an object error, falling back to JSON.stringify', () => {
		const results = [
			{ success: false, error: { message: 'nested message' } },
			{ success: false, error: { code: 'X' } },
			{ success: false, message: 'top-level message' },
			{ error: 'no idString here' },
		];

		const { failed } = mapCreateManyResults([0, 1, 2, 3], results);

		expect(failed).toEqual([
			{ index: 0, message: 'nested message' },
			{ index: 1, message: JSON.stringify({ code: 'X' }) },
			{ index: 2, message: 'top-level message' },
			{ index: 3, message: 'no idString here' },
		]);
	});

	it('falls back to Unknown error when nothing usable is present', () => {
		const { failed } = mapCreateManyResults([0, 1], [null, 42]);

		expect(failed).toEqual([
			{ index: 0, message: 'Unknown error' },
			{ index: 1, message: 'Unknown error' },
		]);
	});
});

describe('uniformChunkResult', () => {
	it('builds one item per index with the shared result merged in and correct pairedItem', () => {
		const items = uniformChunkResult([2, 5], { success: true }, (index) => ({ id: index }));

		expect(items).toEqual([
			{ json: { id: 2, success: true }, pairedItem: { item: 2 } },
			{ json: { id: 5, success: true }, pairedItem: { item: 5 } },
		]);
	});
});
