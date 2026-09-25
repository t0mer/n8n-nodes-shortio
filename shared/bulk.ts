import { sleep } from 'n8n-workflow';
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

/**
 * Chunk size and inter-chunk pacing per bulk endpoint. `minIntervalMs` of 0 means no documented
 * rate limit; the size is still capped by the API's `maxItems` (or a conservative default when
 * undocumented).
 */
export const BULK_LIMITS = {
	createMany: { size: 1000, minIntervalMs: 2000 }, // 5 req / 10 s
	deleteMany: { size: 150, minIntervalMs: 1000 }, // 1 req / s
	archiveMany: { size: 150, minIntervalMs: 0 },
	unarchiveMany: { size: 150, minIntervalMs: 0 },
	tagMany: { size: 150, minIntervalMs: 0 },
	qrMany: { size: 150, minIntervalMs: 0 },
} as const;

export interface ChunkPlan {
	size: number;
	minIntervalMs: number;
}

/** Splits `items` into chunks of at most `size`. Throws when `size` is not a positive integer. */
export function chunk<T>(items: T[], size: number): T[][] {
	if (!Number.isInteger(size) || size <= 0) {
		throw new Error('Chunk size must be a positive integer');
	}

	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

/**
 * Runs `fn` once per chunk of `entries`, sequentially, sleeping `plan.minIntervalMs` between
 * chunks (never before the first chunk, and never when `minIntervalMs` is 0). Returns the
 * per-chunk results in chunk order.
 */
export async function forEachChunk<T, R>(
	entries: T[],
	plan: ChunkPlan,
	fn: (chunk: T[], chunkIndex: number) => Promise<R>,
): Promise<R[]> {
	const chunks = chunk(entries, plan.size);
	const results: R[] = [];

	for (let i = 0; i < chunks.length; i++) {
		if (i > 0 && plan.minIntervalMs > 0) {
			await sleep(plan.minIntervalMs);
		}
		results.push(await fn(chunks[i], i));
	}

	return results;
}

export interface Indexed<T> {
	index: number;
	value: T;
}

/**
 * True when a Create Many response element represents a failure: not a non-null object,
 * `success === false`, or it carries an `error` key without an `idString`.
 */
export function isFailedElement(el: unknown): boolean {
	if (el === null || typeof el !== 'object') return true;

	const record = el as IDataObject;
	if (record.success === false) return true;
	if ('error' in record && !record.idString) return true;

	return false;
}

/** Extracts a human-readable message from a failed Create Many element. */
function failureMessage(el: unknown): string {
	if (el && typeof el === 'object') {
		const record = el as IDataObject;
		const errorValue = record.error;

		if (errorValue !== undefined) {
			if (errorValue && typeof errorValue === 'object') {
				const message = (errorValue as IDataObject).message;
				return typeof message === 'string' ? message : JSON.stringify(errorValue);
			}
			return String(errorValue);
		}

		if (typeof record.message === 'string') return record.message;
	}

	return 'Unknown error';
}

/**
 * Maps a Create Many response array back onto the input indices that produced it: `results[k]`
 * belongs to `indices[k]`. Indices with no corresponding result (a shorter response array) are
 * reported failed.
 */
export function mapCreateManyResults(
	indices: number[],
	results: unknown[],
): { ok: Array<{ index: number; json: IDataObject }>; failed: Array<{ index: number; message: string }> } {
	const ok: Array<{ index: number; json: IDataObject }> = [];
	const failed: Array<{ index: number; message: string }> = [];

	indices.forEach((index, k) => {
		if (k >= results.length) {
			failed.push({ index, message: 'No result returned for this item' });
			return;
		}

		const result = results[k];
		if (isFailedElement(result)) {
			failed.push({ index, message: failureMessage(result) });
		} else {
			ok.push({ index, json: result as IDataObject });
		}
	});

	return { ok, failed };
}

/**
 * Builds one output item per input index for an endpoint that returns a single shared result for
 * the whole chunk (e.g. `{ success, error? }`). Each item's json merges `perItem(index)` with the
 * shared `result`, with `pairedItem` pointing back at that index.
 */
export function uniformChunkResult(
	indices: number[],
	result: IDataObject,
	perItem: (index: number) => IDataObject,
): INodeExecutionData[] {
	return indices.map((index) => ({
		json: { ...perItem(index), ...result },
		pairedItem: { item: index },
	}));
}
