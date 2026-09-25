import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
	BULK_LIMITS,
	chunk,
	forEachChunk,
	mapCreateManyResults,
	uniformChunkResult,
	type ChunkPlan,
	type Indexed,
} from '../../../../shared/bulk';
import { buildLinkBody } from '../../../../shared/fields';
import { resolveDomainId, resolveLinkId } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { BatchHandler, ExecContext } from '../../../../shared/types';

/** Output items collected per input index, flattened in index order at the end. */
export type Slots = INodeExecutionData[][];

const MAX_LISTED_FAILURES = 10;
const MAX_LISTED_INDICES = 50;

export function newSlots(count: number): Slots {
	return Array.from({ length: count }, () => []);
}

export function flatten(slots: Slots): INodeExecutionData[] {
	return slots.flat();
}

/**
 * The continue-on-fail item for `error` at input `index`. `statusCode` is included only for an
 * HTTP error status (>= 400); a `{ success: false }` body on a 200 is not one.
 */
export function errorItem(error: unknown, index: number): INodeExecutionData {
	const statusCode = Number((error as NodeApiError).httpCode);
	return {
		json: {
			error: (error as Error).message,
			...(statusCode >= 400 ? { statusCode } : {}),
		},
		pairedItem: { item: index },
	};
}

/** Tags `error` with `index` (wrapping non-n8n errors) so it can be thrown for that item. */
export function toItemError(
	this: IExecuteFunctions,
	error: unknown,
	index: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		error.context.itemIndex = index;
		return error;
	}
	return new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
}

/**
 * Reads and resolves every input item's parameters with `read` (`exec` is passed explicitly
 * rather than as `this`, because `.call` would erase `T`), each inside its own try. Under
 * continue-on-fail a failing item gets an error item in its slot and is skipped; otherwise the
 * first failure is thrown with its item index.
 */
export async function collect<T>(
	exec: IExecuteFunctions,
	count: number,
	slots: Slots,
	read: (i: number) => Promise<T>,
): Promise<Array<Indexed<T>>> {
	const entries: Array<Indexed<T>> = [];

	for (let i = 0; i < count; i++) {
		let failure: Error | undefined;
		try {
			entries.push({ index: i, value: await read(i) });
		} catch (error) {
			if (exec.continueOnFail()) {
				slots[i].push(errorItem(error, i));
				continue;
			}
			failure = toItemError.call(exec, error, i);
		}
		if (failure) throw failure;
	}

	return entries;
}

/** Groups entries by `keyOf`, keeping first-appearance group order and index order within groups. */
function groupBy<T>(entries: Array<Indexed<T>>, keyOf: (value: T) => string): Array<Array<Indexed<T>>> {
	const groups = new Map<string, Array<Indexed<T>>>();
	for (const entry of entries) {
		const key = keyOf(entry.value);
		const group = groups.get(key);
		if (group) {
			group.push(entry);
		} else {
			groups.set(key, [entry]);
		}
	}
	return [...groups.values()];
}

/**
 * Sends `{ ...extraBody, link_ids }` per chunk of link ids. Each input item gets
 * `{ success: true, idString, ...perItemExtra }`. A chunk whose request fails marks every item in
 * it under continue-on-fail, or is thrown with the chunk's first item index.
 */
async function runUniform(
	this: IExecuteFunctions,
	entries: Array<Indexed<string>>,
	slots: Slots,
	opts: {
		plan: ChunkPlan;
		method: 'POST' | 'DELETE';
		path: string;
		extraBody?: IDataObject;
	},
): Promise<void> {
	const idByIndex = new Map(entries.map((e) => [e.index, e.value]));

	await forEachChunk(entries, opts.plan, async (part) => {
		const indices = part.map((e) => e.index);
		let failure: Error | undefined;

		try {
			await shortIoRequest.call(this, {
				method: opts.method,
				path: opts.path,
				body: { ...opts.extraBody, link_ids: part.map((e) => e.value) },
				resource: 'link',
				itemIndex: indices[0],
			});

			for (const item of uniformChunkResult(indices, { success: true }, (index) => ({
				idString: idByIndex.get(index),
				...opts.extraBody,
			}))) {
				slots[(item.pairedItem as { item: number }).item].push(item);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				for (const index of indices) slots[index].push(errorItem(error, index));
				return;
			}
			failure = toItemError.call(this, error, indices[0]);
		}
		if (failure) throw failure;
	});
}

function readLinkIds(this: IExecuteFunctions, count: number, slots: Slots) {
	return collect(this, count, slots, async (i) => {
		const linkParam = this.getNodeParameter('link', i);
		return await resolveLinkId.call(this, linkParam, i);
	});
}

function uniformHandler(
	plan: ChunkPlan,
	method: 'POST' | 'DELETE',
	path: string,
): BatchHandler {
	return async function (this: IExecuteFunctions, items: INodeExecutionData[]) {
		const slots = newSlots(items.length);
		const entries = await readLinkIds.call(this, items.length, slots);
		await runUniform.call(this, entries, slots, { plan, method, path });
		return flatten(slots);
	};
}

export const archiveMany = uniformHandler(BULK_LIMITS.archiveMany, 'POST', '/links/archive_bulk');
export const unarchiveMany = uniformHandler(
	BULK_LIMITS.unarchiveMany,
	'POST',
	'/links/unarchive_bulk',
);
export const deleteMany = uniformHandler(BULK_LIMITS.deleteMany, 'DELETE', '/links/delete_bulk');

/** Tag Many: one `POST /tags/bulk` series per distinct tag value. */
export async function tagMany(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const slots = newSlots(items.length);

	const entries = await collect(this, items.length, slots, async (i) => {
		const linkParam = this.getNodeParameter('link', i);
		const tag = String(this.getNodeParameter('tag', i) ?? '').trim();
		if (!tag) {
			throw new NodeOperationError(this.getNode(), 'Tag must not be empty', { itemIndex: i });
		}
		const idString = await resolveLinkId.call(this, linkParam, i);
		return { idString, tag };
	});

	for (const group of groupBy(entries, (v) => v.tag)) {
		await runUniform.call(
			this,
			group.map((e) => ({ index: e.index, value: e.value.idString })),
			slots,
			{
				plan: BULK_LIMITS.tagMany,
				method: 'POST',
				path: '/tags/bulk',
				extraBody: { tag: group[0].value.tag },
			},
		);
	}

	return flatten(slots);
}

/** `5, 9, 12`, capped at {@link MAX_LISTED_INDICES} entries followed by `, …`. */
function formatIndices(indices: number[]): string {
	const listed = indices.slice(0, MAX_LISTED_INDICES).join(', ');
	return indices.length > MAX_LISTED_INDICES ? `${listed}, …` : listed;
}

/** `msg; msg`, capped at {@link MAX_LISTED_FAILURES} messages followed by ` …and N more`. */
function formatMessages(failed: Array<{ message: string }>): string {
	const listed = failed.slice(0, MAX_LISTED_FAILURES).map((f) => f.message);
	const more = failed.length - listed.length;
	return `${listed.join('; ')}${more > 0 ? ` …and ${more} more` : ''}`;
}

const CONTINUE_HINT =
	'enable "Continue On Fail" to receive created links and per-item errors as items';

interface CreateManyEntry {
	hostname: string;
	folderId?: string;
	link: IDataObject;
}

interface CreateManyRequest {
	hostname: string;
	folderId?: string;
	entries: Array<Indexed<CreateManyEntry>>;
}

/**
 * Create Many: groups items by (domain hostname, folder), since `POST /links/bulk` takes both at
 * the top level only, then sends each group in chunks of up to 1000 links. Pacing applies between
 * any two consecutive `/links/bulk` calls, across groups. Failed elements are gathered over the
 * whole run and reported (or thrown) at the end.
 */
export async function createMany(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	ctx: ExecContext,
): Promise<INodeExecutionData[]> {
	const slots = newSlots(items.length);

	const entries = await collect(this, items.length, slots, async (i) => {
		const domainParam = this.getNodeParameter('domain', i);
		const originalURL = this.getNodeParameter('originalURL', i) as string;
		const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

		const domain = await ctx.domains.get(this, resolveDomainId(domainParam));
		const link: IDataObject = { originalURL, ...buildLinkBody(additionalFields) };
		const folderId = link.folderId as string | undefined;
		delete link.folderId;

		return { hostname: domain.hostname, folderId, link } as CreateManyEntry;
	});

	const requests: CreateManyRequest[] = [];
	for (const group of groupBy(entries, (v) => `${v.hostname}\u0000${v.folderId ?? ''}`)) {
		for (const part of chunk(group, BULK_LIMITS.createMany.size)) {
			requests.push({
				hostname: group[0].value.hostname,
				folderId: group[0].value.folderId,
				entries: part,
			});
		}
	}

	const failed: Array<{ index: number; message: string }> = [];
	const total = entries.length;
	let created = 0;

	// The requests are pre-chunked, so pace them one at a time across all groups.
	await forEachChunk(
		requests,
		{ size: 1, minIntervalMs: BULK_LIMITS.createMany.minIntervalMs },
		async ([request]) => {
			const indices = request.entries.map((e) => e.index);
			let failure: Error | undefined;

			try {
				const response = await shortIoRequest.call(this, {
					method: 'POST',
					path: '/links/bulk',
					body: {
						domain: request.hostname,
						...(request.folderId ? { folderId: request.folderId } : {}),
						links: request.entries.map((e) => e.value.link),
					},
					resource: 'link',
					itemIndex: indices[0],
				});

				const result = mapCreateManyResults(indices, Array.isArray(response) ? response : []);
				for (const { index, json } of result.ok) {
					slots[index].push({ json, pairedItem: { item: index } });
				}
				created += result.ok.length;
				failed.push(...result.failed);
			} catch (error) {
				if (this.continueOnFail()) {
					for (const index of indices) slots[index].push(errorItem(error, index));
					return;
				}
				if (created === 0 && failed.length === 0) {
					failure = toItemError.call(this, error, indices[0]);
				} else {
					// Earlier requests already created links or reported failed elements: say so, since
					// neither reaches the output once this error is thrown.
					failed.sort((a, b) => a.index - b.index);
					const earlier =
						failed.length > 0
							? `; items ${formatIndices(failed.map((f) => f.index))} had already failed: ${formatMessages(failed)}`
							: '';
					const summary = `${created} of ${total} links were created before the failure${earlier}; ${CONTINUE_HINT}`;
					failure = new NodeOperationError(
						this.getNode(),
						`Create Many failed at item ${indices[0]}: ${(error as Error).message} (${summary})`,
						{ description: summary, itemIndex: indices[0] },
					);
				}
			}
			if (failure) throw failure;
		},
	);

	if (failed.length > 0) {
		failed.sort((a, b) => a.index - b.index);

		if (!this.continueOnFail()) {
			const summary = `${created} of ${total} links were created; ${CONTINUE_HINT}`;
			throw new NodeOperationError(
				this.getNode(),
				`Create Many failed for items ${formatIndices(failed.map((f) => f.index))}: ${formatMessages(failed)} (${summary})`,
				{ description: summary, itemIndex: failed[0].index },
			);
		}

		for (const { index, message } of failed) {
			slots[index].push({ json: { error: message }, pairedItem: { item: index } });
		}
	}

	return flatten(slots);
}
