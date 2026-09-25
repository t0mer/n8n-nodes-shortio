import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeOperationError, sleep } from 'n8n-workflow';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
	archiveMany,
	createMany,
	deleteMany,
	tagMany,
	unarchiveMany,
} from '../nodes/ShortIo/resources/link/bulk';
import { HANDLERS } from '../nodes/ShortIo/resources';
import { DomainCache } from '../shared/locators';
import type { BatchHandler, ExecContext } from '../shared/types';
import { fakeCtx, type Resp } from './helpers';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

beforeEach(() => {
	vi.mocked(sleep).mockClear();
});

type Params = Record<string, unknown>;

function fakeExec(perItem: Params[], responses: Resp[], continueOnFail = false): IExecuteFunctions {
	return fakeCtx(responses, {
		getNodeParameter: (name: string, i: number, fallback?: unknown) => {
			const value = perItem[i]?.[name];
			if (value instanceof Error) throw value;
			return value !== undefined ? value : fallback;
		},
		continueOnFail: () => continueOnFail,
	}) as unknown as IExecuteFunctions;
}

function calls(exec: IExecuteFunctions) {
	return (
		exec.helpers.httpRequestWithAuthentication as unknown as {
			mock: { calls: Array<[string, { method: string; url: string; body?: unknown }]> };
		}
	).mock.calls.map(([, opts]) => opts);
}

function run(handler: BatchHandler, exec: IExecuteFunctions, count: number) {
	const items: INodeExecutionData[] = Array.from({ length: count }, () => ({ json: {} }));
	const ctx: ExecContext = { domains: new DomainCache() };
	return handler.call(exec, items, ctx);
}

const domain = (id: string) => ({ __rl: true, mode: 'id', value: id });
const link = (id: string) => ({ __rl: true, mode: 'id', value: id });
const HINT = 'enable "Continue On Fail" to receive created links and per-item errors as items';
const DOMAIN_RESP: Resp = { statusCode: 200, body: { id: 1, hostname: 's.gy' } };

describe('registry', () => {
	it('registers every bulk operation as a batch handler', () => {
		for (const op of ['archiveMany', 'createMany', 'deleteMany', 'tagMany', 'unarchiveMany']) {
			expect(HANDLERS.link[op].kind).toBe('batch');
		}
	});
});

describe('link create many', () => {
	it('sends 1001 items in one domain as 2 requests with a single 2000 ms sleep', async () => {
		const params = Array.from({ length: 1001 }, (_, i) => ({
			domain: domain('1'),
			originalURL: `https://example.com/${i}`,
		}));
		const created = (from: number, n: number) =>
			Array.from({ length: n }, (_, k) => ({ idString: `link_${from + k}`, success: true }));
		const exec = fakeExec(params, [
			DOMAIN_RESP,
			{ statusCode: 200, body: created(0, 1000) },
			{ statusCode: 200, body: created(1000, 1) },
		]);

		const out = await run(createMany, exec, 1001);

		const bulkCalls = calls(exec).filter((c) => c.url.endsWith('/links/bulk'));
		expect(bulkCalls).toHaveLength(2);
		expect((bulkCalls[0].body as { links: unknown[] }).links).toHaveLength(1000);
		expect(bulkCalls[1].body).toEqual({
			domain: 's.gy',
			links: [{ originalURL: 'https://example.com/1000' }],
		});
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(sleep).toHaveBeenCalledWith(2000);
		expect(out).toHaveLength(1001);
		expect(out[1000]).toEqual({
			json: { idString: 'link_1000', success: true },
			pairedItem: { item: 1000 },
		});
	});

	it('groups by (hostname, folder) and sends folderId top-level, not per link', async () => {
		const params = [
			{ domain: domain('1'), originalURL: 'https://a', additionalFields: { folderId: 'f1' } },
			{ domain: domain('1'), originalURL: 'https://b', additionalFields: { folderId: 'f2' } },
			{
				domain: domain('1'),
				originalURL: 'https://c',
				additionalFields: { folderId: { __rl: true, mode: 'id', value: 'f1' }, allowDuplicates: true },
			},
		];
		const exec = fakeExec(params, [
			DOMAIN_RESP,
			{
				statusCode: 200,
				body: [
					{ idString: 'link_a', success: true },
					{ idString: 'link_c', success: true },
				],
			},
			{ statusCode: 200, body: [{ idString: 'link_b', success: true }] },
		]);

		const out = await run(createMany, exec, 3);

		const bulkCalls = calls(exec).filter((c) => c.url.endsWith('/links/bulk'));
		expect(bulkCalls.map((c) => c.body)).toEqual([
			{
				domain: 's.gy',
				folderId: 'f1',
				links: [{ originalURL: 'https://a' }, { originalURL: 'https://c', allowDuplicates: true }],
			},
			{ domain: 's.gy', folderId: 'f2', links: [{ originalURL: 'https://b' }] },
		]);
		// Pacing applies across groups too.
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(out.map((o) => [o.json.idString, o.pairedItem])).toEqual([
			['link_a', { item: 0 }],
			['link_b', { item: 1 }],
			['link_c', { item: 2 }],
		]);
	});

	it('with continue-on-fail, puts an error item at each failed index, in index order', async () => {
		const params = [0, 1, 2].map((i) => ({ domain: domain('1'), originalURL: `https://x/${i}` }));
		const exec = fakeExec(
			params,
			[
				DOMAIN_RESP,
				{
					statusCode: 200,
					body: [
						{ idString: 'link_0', success: true },
						{ success: false, error: 'Path already taken' },
						{ idString: 'link_2', success: true },
					],
				},
			],
			true,
		);

		const out = await run(createMany, exec, 3);

		expect(out).toEqual([
			{ json: { idString: 'link_0', success: true }, pairedItem: { item: 0 } },
			{ json: { error: 'Path already taken' }, pairedItem: { item: 1 } },
			{ json: { idString: 'link_2', success: true }, pairedItem: { item: 2 } },
		]);
	});

	it('without continue-on-fail, throws one error listing the failing indices after all chunks', async () => {
		const params = Array.from({ length: 1002 }, (_, i) => ({
			domain: domain('1'),
			originalURL: `https://x/${i}`,
		}));
		const first = Array.from({ length: 1000 }, (_, k) =>
			k === 5 ? { success: false, error: 'bad five' } : { idString: `link_${k}`, success: true },
		);
		const exec = fakeExec(params, [
			DOMAIN_RESP,
			{ statusCode: 200, body: first },
			{
				statusCode: 200,
				body: [
					{ idString: 'link_1000', success: true },
					{ success: false, message: 'bad 1001' },
				],
			},
		]);

		const error = await run(createMany, exec, 1002).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toBe(
			`Create Many failed for items 5, 1001: bad five; bad 1001 (1000 of 1002 links were created; ${HINT})`,
		);
		expect((error as NodeOperationError).description).toBe(
			`1000 of 1002 links were created; ${HINT}`,
		);
		expect((error as NodeOperationError).context.itemIndex).toBe(5);
		expect(calls(exec).filter((c) => c.url.endsWith('/links/bulk'))).toHaveLength(2);
	});

	it('caps the listed failure messages at 10', async () => {
		const params = Array.from({ length: 12 }, (_, i) => ({
			domain: domain('1'),
			originalURL: `https://x/${i}`,
		}));
		const exec = fakeExec(params, [
			DOMAIN_RESP,
			{
				statusCode: 200,
				body: Array.from({ length: 12 }, (_, k) => ({ success: false, error: `e${k}` })),
			},
		]);

		const error = (await run(createMany, exec, 12).catch((e: unknown) => e)) as Error;

		expect(error.message).toBe(
			`Create Many failed for items 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11: e0; e1; e2; e3; e4; e5; e6; e7; e8; e9 …and 2 more (0 of 12 links were created; ${HINT})`,
		);
	});

	it('with continue-on-fail, a parameter error on one item does not block the others', async () => {
		const params = [
			{ domain: domain('1'), originalURL: 'https://a' },
			{ domain: domain('abc'), originalURL: 'https://b' },
			{ domain: domain('1'), originalURL: 'https://c' },
		];
		const exec = fakeExec(
			params,
			[
				DOMAIN_RESP,
				{
					statusCode: 200,
					body: [
						{ idString: 'link_a', success: true },
						{ idString: 'link_c', success: true },
					],
				},
			],
			true,
		);

		const out = await run(createMany, exec, 3);

		expect(out).toEqual([
			{ json: { idString: 'link_a', success: true }, pairedItem: { item: 0 } },
			{ json: { error: 'Domain ID must be a positive integer' }, pairedItem: { item: 1 } },
			{ json: { idString: 'link_c', success: true }, pairedItem: { item: 2 } },
		]);
	});

	it('without continue-on-fail, a parameter error throws with its item index before any request', async () => {
		const params = [
			{ domain: domain('1'), originalURL: 'https://a' },
			{ domain: domain('abc'), originalURL: 'https://b' },
		];
		const exec = fakeExec(params, [DOMAIN_RESP]);

		const error = (await run(createMany, exec, 2).catch((e: unknown) => e)) as NodeOperationError;

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.context.itemIndex).toBe(1);
		expect(calls(exec).some((c) => c.url.endsWith('/links/bulk'))).toBe(false);
	});

	it('with continue-on-fail, a failed whole request marks every item in that chunk', async () => {
		const params = [
			{ domain: domain('1'), originalURL: 'https://a', additionalFields: { folderId: 'f1' } },
			{ domain: domain('1'), originalURL: 'https://b', additionalFields: { folderId: 'f2' } },
			{ domain: domain('1'), originalURL: 'https://c', additionalFields: { folderId: 'f1' } },
		];
		const exec = fakeExec(
			params,
			[
				DOMAIN_RESP,
				{ statusCode: 400, body: { error: 'Invalid body' } },
				{ statusCode: 200, body: [{ idString: 'link_b', success: true }] },
			],
			true,
		);

		const out = await run(createMany, exec, 3);

		expect(out).toEqual([
			{ json: { error: 'Short.io error: Invalid body', statusCode: 400 }, pairedItem: { item: 0 } },
			{ json: { idString: 'link_b', success: true }, pairedItem: { item: 1 } },
			{ json: { error: 'Short.io error: Invalid body', statusCode: 400 }, pairedItem: { item: 2 } },
		]);
	});

	it('without continue-on-fail, a failed whole request throws with the chunk first index', async () => {
		const params = [
			{ domain: domain('1'), originalURL: 'https://a' },
			{ domain: domain('1'), originalURL: 'https://b' },
		];
		const exec = fakeExec(params, [DOMAIN_RESP, { statusCode: 400, body: { error: 'Invalid body' } }]);

		const error = (await run(createMany, exec, 2).catch((e: unknown) => e)) as NodeOperationError;

		expect(error.message).toBe('Short.io error: Invalid body');
		expect(error.context.itemIndex).toBe(0);
	});

	it('caps the listed failing indices at 50', async () => {
		const params = Array.from({ length: 52 }, (_, i) => ({
			domain: domain('1'),
			originalURL: `https://x/${i}`,
		}));
		const exec = fakeExec(params, [
			DOMAIN_RESP,
			{
				statusCode: 200,
				body: Array.from({ length: 52 }, () => ({ success: false, error: 'e' })),
			},
		]);

		const error = (await run(createMany, exec, 52).catch((e: unknown) => e)) as Error;

		const fifty = Array.from({ length: 50 }, (_, i) => i).join(', ');
		expect(error.message.startsWith(`Create Many failed for items ${fifty}, …: `)).toBe(true);
	});

	it('without continue-on-fail, a whole-request failure after created links reports the created count', async () => {
		const params = Array.from({ length: 1002 }, (_, i) => ({
			domain: domain('1'),
			originalURL: `https://x/${i}`,
		}));
		const first = Array.from({ length: 1000 }, (_, k) =>
			k === 7 ? { success: false, error: 'bad seven' } : { idString: `link_${k}`, success: true },
		);
		const exec = fakeExec(params, [
			DOMAIN_RESP,
			{ statusCode: 200, body: first },
			{ statusCode: 400, body: { error: 'Invalid body' } },
		]);

		const error = (await run(createMany, exec, 1002).catch((e: unknown) => e)) as NodeOperationError;

		const summary = `999 of 1002 links were created before the failure; items 7 had already failed: bad seven; ${HINT}`;
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe(
			`Create Many failed at item 1000: Short.io error: Invalid body (${summary})`,
		);
		expect(error.description).toBe(summary);
		expect(error.context.itemIndex).toBe(1000);
	});

	it('marks the missing indices failed when the response is shorter than the chunk', async () => {
		const params = [0, 1, 2].map((i) => ({ domain: domain('1'), originalURL: `https://x/${i}` }));
		const exec = fakeExec(
			params,
			[DOMAIN_RESP, { statusCode: 200, body: [{ idString: 'link_0', success: true }] }],
			true,
		);

		const out = await run(createMany, exec, 3);

		expect(out).toEqual([
			{ json: { idString: 'link_0', success: true }, pairedItem: { item: 0 } },
			{ json: { error: 'No result returned for this item' }, pairedItem: { item: 1 } },
			{ json: { error: 'No result returned for this item' }, pairedItem: { item: 2 } },
		]);
	});

	it('marks every index failed when the response is not an array', async () => {
		const params = [0, 1].map((i) => ({ domain: domain('1'), originalURL: `https://x/${i}` }));
		const exec = fakeExec(params, [DOMAIN_RESP, { statusCode: 200, body: { ok: true } }]);

		const error = (await run(createMany, exec, 2).catch((e: unknown) => e)) as Error;

		expect(error.message).toBe(
			`Create Many failed for items 0, 1: No result returned for this item; No result returned for this item (0 of 2 links were created; ${HINT})`,
		);
	});
});

describe('link delete / archive / unarchive many', () => {
	it('Delete Many sends DELETE /links/delete_bulk with a link_ids body', async () => {
		const exec = fakeExec(
			[{ link: link('link_a') }, { link: link('link_b') }],
			[{ statusCode: 200, body: { success: true } }],
		);

		const out = await run(deleteMany, exec, 2);

		expect(calls(exec)).toEqual([
			expect.objectContaining({
				method: 'DELETE',
				url: 'https://api.short.io/links/delete_bulk',
				body: { link_ids: ['link_a', 'link_b'] },
			}),
		]);
		expect(out).toEqual([
			{ json: { success: true, idString: 'link_a' }, pairedItem: { item: 0 } },
			{ json: { success: true, idString: 'link_b' }, pairedItem: { item: 1 } },
		]);
	});

	it('Delete Many chunks at 150 and sleeps 1000 ms between chunks', async () => {
		const params = Array.from({ length: 151 }, (_, i) => ({ link: link(`link_${i}`) }));
		const exec = fakeExec(params, [
			{ statusCode: 200, body: { success: true } },
			{ statusCode: 200, body: { success: true } },
		]);

		await run(deleteMany, exec, 151);

		expect(calls(exec)).toHaveLength(2);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(sleep).toHaveBeenCalledWith(1000);
	});

	it.each([
		['Archive Many', archiveMany, '/links/archive_bulk'],
		['Unarchive Many', unarchiveMany, '/links/unarchive_bulk'],
	])('%s posts link_ids to %s', async (_name, handler, path) => {
		const exec = fakeExec([{ link: link('link_a') }], [{ statusCode: 200, body: { success: true } }]);

		const out = await run(handler, exec, 1);

		expect(calls(exec)[0]).toMatchObject({
			method: 'POST',
			url: `https://api.short.io${path}`,
			body: { link_ids: ['link_a'] },
		});
		expect(out).toEqual([{ json: { success: true, idString: 'link_a' }, pairedItem: { item: 0 } }]);
	});

	it('with continue-on-fail, a failed chunk marks all of its items and later chunks still run', async () => {
		const params = Array.from({ length: 151 }, (_, i) => ({ link: link(`link_${i}`) }));
		const exec = fakeExec(
			params,
			[
				{ statusCode: 200, body: { success: false, error: 'nope' } },
				{ statusCode: 200, body: { success: true } },
			],
			true,
		);

		const out = await run(archiveMany, exec, 151);

		expect(out).toHaveLength(151);
		expect(out[0]).toEqual({
			json: { error: 'Short.io error: nope' },
			pairedItem: { item: 0 },
		});
		expect(out[149].json).toMatchObject({ error: 'Short.io error: nope' });
		expect(out[150]).toEqual({
			json: { success: true, idString: 'link_150' },
			pairedItem: { item: 150 },
		});
	});

	it('Unarchive Many with continue-on-fail marks a whole failed chunk, with statusCode for HTTP errors', async () => {
		const exec = fakeExec(
			[{ link: link('link_a') }, { link: link('link_b') }],
			[{ statusCode: 500, body: { error: 'boom' } }],
			true,
		);

		const out = await run(unarchiveMany, exec, 2);

		expect(out).toEqual([
			{ json: { error: 'Short.io error: boom', statusCode: 500 }, pairedItem: { item: 0 } },
			{ json: { error: 'Short.io error: boom', statusCode: 500 }, pairedItem: { item: 1 } },
		]);
	});

	it('Tag Many with continue-on-fail marks the failed tag group only', async () => {
		const exec = fakeExec(
			[
				{ link: link('link_a'), tag: 'red' },
				{ link: link('link_b'), tag: 'blue' },
			],
			[
				{ statusCode: 400, body: { error: 'bad tag' } },
				{ statusCode: 200, body: {} },
			],
			true,
		);

		const out = await run(tagMany, exec, 2);

		expect(out).toEqual([
			{ json: { error: 'Short.io error: bad tag', statusCode: 400 }, pairedItem: { item: 0 } },
			{ json: { success: true, idString: 'link_b', tag: 'blue' }, pairedItem: { item: 1 } },
		]);
	});

	it('without continue-on-fail, a failed chunk throws with its first index', async () => {
		const params = Array.from({ length: 151 }, (_, i) => ({ link: link(`link_${i}`) }));
		const exec = fakeExec(params, [
			{ statusCode: 200, body: { success: true } },
			{ statusCode: 400, body: { error: 'bad' } },
		]);

		const error = (await run(archiveMany, exec, 151).catch((e: unknown) => e)) as NodeOperationError;

		expect(error.context.itemIndex).toBe(150);
	});

	it('with continue-on-fail, an invalid link id becomes an error item and is not sent', async () => {
		const exec = fakeExec(
			[{ link: link('link_a') }, { link: link('nope') }],
			[{ statusCode: 200, body: { success: true } }],
			true,
		);

		const out = await run(deleteMany, exec, 2);

		expect(calls(exec)[0].body).toEqual({ link_ids: ['link_a'] });
		expect(out[1]).toEqual({
			json: { error: '"nope" is not a valid link ID' },
			pairedItem: { item: 1 },
		});
	});
});

describe('link tag many', () => {
	it('groups by tag, one POST /tags/bulk per tag, and outputs in index order', async () => {
		const exec = fakeExec(
			[
				{ link: link('link_a'), tag: 'red' },
				{ link: link('link_b'), tag: 'blue' },
				{ link: link('link_c'), tag: 'red' },
			],
			[
				{ statusCode: 200, body: {} },
				{ statusCode: 200, body: {} },
			],
		);

		const out = await run(tagMany, exec, 3);

		expect(calls(exec).map((c) => [c.method, c.url, c.body])).toEqual([
			['POST', 'https://api.short.io/tags/bulk', { tag: 'red', link_ids: ['link_a', 'link_c'] }],
			['POST', 'https://api.short.io/tags/bulk', { tag: 'blue', link_ids: ['link_b'] }],
		]);
		expect(out).toEqual([
			{ json: { success: true, idString: 'link_a', tag: 'red' }, pairedItem: { item: 0 } },
			{ json: { success: true, idString: 'link_b', tag: 'blue' }, pairedItem: { item: 1 } },
			{ json: { success: true, idString: 'link_c', tag: 'red' }, pairedItem: { item: 2 } },
		]);
	});

	it.each([['  '], [undefined], [null]])('rejects an empty tag (%j) for that item', async (tag) => {
		const exec = fakeExec([{ link: link('link_a'), tag }], []);

		const error = (await run(tagMany, exec, 1).catch((e: unknown) => e)) as NodeOperationError;

		expect(error.message).toBe('Tag must not be empty');
		expect(error.context.itemIndex).toBe(0);
	});
});
