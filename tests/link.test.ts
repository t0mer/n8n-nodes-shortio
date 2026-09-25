import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { linkHandlers } from '../nodes/ShortIo/resources/link/execute';
import { DomainCache } from '../shared/locators';
import type { ExecContext, ItemHandler } from '../shared/types';
import { fakeCtx, type Resp } from './helpers';

function newCtx(): ExecContext {
	return { domains: new DomainCache() };
}

function fakeExec(params: Record<string, unknown>, responses: Resp[], tz?: string): IExecuteFunctions {
	return fakeCtx(responses, {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		continueOnFail: () => false,
		...(tz !== undefined ? { getTimezone: () => tz } : {}),
	}) as unknown as IExecuteFunctions;
}

function calls(exec: IExecuteFunctions) {
	return (exec.helpers.httpRequestWithAuthentication as unknown as { mock: { calls: unknown[][] } })
		.mock.calls;
}

function run(entry: (typeof linkHandlers)[string], exec: IExecuteFunctions, i: number, ctx: ExecContext) {
	return (entry.run as ItemHandler).call(exec, i, ctx);
}

describe('link create', () => {
	it('resolves the domain hostname and sends POST /links with the built body', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'list', value: '123' },
				originalURL: 'https://example.com',
				additionalFields: { title: 'My Link', tags: 'a,b', allowDuplicates: false },
			},
			[
				{ statusCode: 200, body: { id: 123, hostname: 's.gy' } },
				{ statusCode: 200, body: { idString: 'link_abc', originalURL: 'https://example.com' } },
			],
		);

		const [item] = await run(linkHandlers.create, exec, 0, newCtx());

		expect(exec.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);

		const [, domainOpts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(domainOpts).toMatchObject({ method: 'GET', url: 'https://api.short.io/domains/123' });

		const [, createOpts] = calls(exec)[1] as [string, { method: string; url: string; body: unknown }];
		expect(createOpts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/links',
			body: {
				domain: 's.gy',
				originalURL: 'https://example.com',
				title: 'My Link',
				tags: ['a', 'b'],
				allowDuplicates: false,
			},
		});

		expect(item.json).toEqual({ idString: 'link_abc', originalURL: 'https://example.com' });
	});

	it('sends no additional fields beyond domain and originalURL when none are set', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '5' }, originalURL: 'https://example.com' },
			[
				{ statusCode: 200, body: { id: 5, hostname: 's.gy' } },
				{ statusCode: 200, body: { idString: 'link_x' } },
			],
		);

		await run(linkHandlers.create, exec, 0, newCtx());

		const [, createOpts] = calls(exec)[1] as [string, { body: unknown }];
		expect(createOpts.body).toEqual({ domain: 's.gy', originalURL: 'https://example.com' });
	});
});

describe('link get', () => {
	it('sends GET /links/{id}', async () => {
		const exec = fakeExec({ link: { __rl: true, mode: 'id', value: 'lnk_abc_d' } }, [
			{ statusCode: 200, body: { idString: 'lnk_abc_d', originalURL: 'https://example.com' } },
		]);

		const [item] = await run(linkHandlers.get, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/links/lnk_abc_d' });
		expect(item.json).toEqual({ idString: 'lnk_abc_d', originalURL: 'https://example.com' });
	});
});

describe('link get by path', () => {
	it('resolves the domain hostname, strips a leading slash, and sends GET /links/expand', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' }, path: '/my/path' },
			[
				{ statusCode: 200, body: { id: 123, hostname: 's.gy' } },
				{ statusCode: 200, body: { idString: 'link_abc', path: 'my/path' } },
			],
		);

		const [item] = await run(linkHandlers.getByPath, exec, 0, newCtx());

		const [, expandOpts] = calls(exec)[1] as [string, { method: string; url: string; qs: unknown }];
		expect(expandOpts).toMatchObject({
			method: 'GET',
			url: 'https://api.short.io/links/expand',
			qs: { domain: 's.gy', path: 'my/path' },
		});
		expect(item.json).toEqual({ idString: 'link_abc', path: 'my/path' });
	});
});

describe('link get by original URL', () => {
	it('sends GET /links/multiple-by-url and returns one item per link', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' }, originalURL: 'https://example.com' },
			[
				{ statusCode: 200, body: { id: 123, hostname: 's.gy' } },
				{
					statusCode: 200,
					body: { links: [{ idString: 'link_a' }, { idString: 'link_b' }] },
				},
			],
		);

		const items = await run(linkHandlers.getByOriginalUrl, exec, 0, newCtx());

		const [, opts] = calls(exec)[1] as [string, { method: string; url: string; qs: unknown }];
		expect(opts).toMatchObject({
			method: 'GET',
			url: 'https://api.short.io/links/multiple-by-url',
			qs: { domain: 's.gy', originalURL: 'https://example.com' },
		});
		expect(items).toHaveLength(2);
		expect(items[0].json).toEqual({ idString: 'link_a' });
		expect(items[1].json).toEqual({ idString: 'link_b' });
	});

	it('returns no items when the links list is empty', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' }, originalURL: 'https://example.com' },
			[
				{ statusCode: 200, body: { id: 123, hostname: 's.gy' } },
				{ statusCode: 200, body: { links: [] } },
			],
		);

		const items = await run(linkHandlers.getByOriginalUrl, exec, 0, newCtx());

		expect(items).toEqual([]);
	});
});

describe('link get many', () => {
	it('sends GET /api/links with domain_id and returns one item per link', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				returnAll: false,
				limit: 50,
				filters: {},
			},
			[
				{
					statusCode: 200,
					body: { count: 1, links: [{ idString: 'link_a' }], nextPageToken: null },
				},
			],
		);

		const items = await run(linkHandlers.getMany, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; qs: unknown }];
		expect(opts).toMatchObject({
			method: 'GET',
			url: 'https://api.short.io/api/links',
			qs: { domain_id: 123, limit: 50 },
		});
		expect(items).toHaveLength(1);
		expect(items[0].json).toEqual({ idString: 'link_a' });
	});

	it('sends the filters collection through toInstant/locatorValue', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: false,
				limit: 50,
				filters: {
					afterDate: '2026-01-01T00:00:00.000Z',
					beforeDate: '2026-06-01T00:00:00.000Z',
					createdAt: '2026-02-01T00:00:00.000Z',
					dateSortOrder: 'asc',
					folderId: { __rl: true, mode: 'list', value: 'fld_1' },
				},
			},
			[{ statusCode: 200, body: { count: 0, links: [], nextPageToken: null } }],
		);

		await run(linkHandlers.getMany, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { qs: unknown }];
		expect(opts.qs).toEqual({
			domain_id: 5,
			limit: 50,
			afterDate: '2026-01-01T00:00:00.000Z',
			beforeDate: '2026-06-01T00:00:00.000Z',
			createdAt: '2026-02-01T00:00:00.000Z',
			dateSortOrder: 'asc',
			folderId: 'fld_1',
		});
	});

	it('interprets a zone-less filter date as wall-clock time in the workflow timezone, not a fixed/host one', async () => {
		// The bug this closes: the filters used to go through toIsoDate alone, which parses a
		// zone-less string with `new Date(raw)` in the n8n HOST process's own timezone. Checking two
		// different explicit workflow tz values against the same input proves the result tracks the
		// passed tz — this sandbox's own host process happens to default to Asia/Jerusalem, so
		// asserting only that one tz wouldn't distinguish the fix from the old host-TZ-dependent bug.
		const runWithTz = async (tz: string) => {
			const exec = fakeExec(
				{
					domain: { __rl: true, mode: 'id', value: '5' },
					returnAll: false,
					limit: 50,
					filters: { afterDate: '2026-09-25T12:00:00' },
				},
				[{ statusCode: 200, body: { count: 0, links: [], nextPageToken: null } }],
				tz,
			);
			await run(linkHandlers.getMany, exec, 0, newCtx());
			const [, opts] = calls(exec)[0] as [string, { qs: { afterDate: string } }];
			return opts.qs.afterDate;
		};

		expect(await runWithTz('Asia/Jerusalem')).toBe('2026-09-25T09:00:00.000Z');
		expect(await runWithTz('America/New_York')).toBe('2026-09-25T16:00:00.000Z');
	});

	it('filters by ID string client-side across pages, never sending it as a query param', async () => {
		// The live API ignores `idString` server-side and returns every link, so the node must not
		// send it and must find the match itself.
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: true,
				filters: { idString: 'link_b' },
			},
			[
				{
					statusCode: 200,
					body: { count: 2, links: [{ idString: 'link_a' }], nextPageToken: 'page_2' },
				},
				{
					statusCode: 200,
					body: { count: 2, links: [{ idString: 'link_b' }], nextPageToken: null },
				},
			],
		);

		const items = await run(linkHandlers.getMany, exec, 0, newCtx());

		expect(exec.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		const [, firstOpts] = calls(exec)[0] as [string, { qs: Record<string, unknown> }];
		expect(firstOpts.qs.idString).toBeUndefined();
		const [, secondOpts] = calls(exec)[1] as [string, { qs: Record<string, unknown> }];
		expect(secondOpts.qs.idString).toBeUndefined();
		expect(items).toHaveLength(1);
		expect(items[0].json).toEqual({ idString: 'link_b' });
	});

	it('finds a match on page 2 even with returnAll off and a Limit of 50, requesting full 150-item pages', async () => {
		// Regression: the ID search must scan at full page size regardless of the UI's own result
		// limit, or a match past that limit is missed entirely.
		const page1 = Array.from({ length: 50 }, (_, n) => ({ idString: `link_${n}` }));
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: false,
				limit: 50,
				filters: { idString: 'link_target' },
			},
			[
				{
					statusCode: 200,
					body: { count: 50, links: page1, nextPageToken: 'page_2' },
				},
				{
					statusCode: 200,
					body: { count: 1, links: [{ idString: 'link_target' }], nextPageToken: null },
				},
			],
		);

		const items = await run(linkHandlers.getMany, exec, 0, newCtx());

		expect(exec.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		const [, firstOpts] = calls(exec)[0] as [string, { qs: Record<string, unknown> }];
		const [, secondOpts] = calls(exec)[1] as [string, { qs: Record<string, unknown> }];
		expect(firstOpts.qs).toMatchObject({ limit: 150 });
		expect(secondOpts.qs).toMatchObject({ limit: 150, pageToken: 'page_2' });
		expect(items).toHaveLength(1);
		expect(items[0].json).toEqual({ idString: 'link_target' });
	});

	it('returns zero items when the ID string filter matches nothing after exhausting the pages', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: true,
				filters: { idString: 'link_zzz' },
			},
			[
				{
					statusCode: 200,
					body: { count: 1, links: [{ idString: 'link_a' }], nextPageToken: null },
				},
			],
		);

		const items = await run(linkHandlers.getMany, exec, 0, newCtx());

		expect(items).toEqual([]);
	});

	it('drops an empty folderId filter instead of sending an empty string', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: false,
				limit: 50,
				filters: { folderId: { __rl: true, mode: 'list', value: '' } },
			},
			[{ statusCode: 200, body: { count: 0, links: [], nextPageToken: null } }],
		);

		await run(linkHandlers.getMany, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { qs: unknown }];
		expect(opts.qs).toEqual({ domain_id: 5, limit: 50 });
	});

	it('trims the page size to the remaining limit and stops after the first page', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: false,
				limit: 2,
				filters: {},
			},
			[
				{
					statusCode: 200,
					body: {
						count: 10,
						links: [{ idString: 'link_a' }, { idString: 'link_b' }],
						nextPageToken: 'page_x',
					},
				},
			],
		);

		const items = await run(linkHandlers.getMany, exec, 0, newCtx());

		expect(exec.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, opts] = calls(exec)[0] as [string, { qs: unknown }];
		expect(opts.qs).toMatchObject({ limit: 2 });
		expect(items).toHaveLength(2);
	});

	it('follows nextPageToken across pages when returnAll is set', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '5' },
				returnAll: true,
				filters: {},
			},
			[
				{
					statusCode: 200,
					body: { count: 2, links: [{ idString: 'link_a' }], nextPageToken: 'page_2' },
				},
				{
					statusCode: 200,
					body: { count: 2, links: [{ idString: 'link_b' }], nextPageToken: null },
				},
			],
		);

		const items = await run(linkHandlers.getMany, exec, 0, newCtx());

		expect(exec.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		const [, firstOpts] = calls(exec)[0] as [string, { qs: Record<string, unknown> }];
		expect(firstOpts.qs.pageToken).toBeUndefined();
		const [, secondOpts] = calls(exec)[1] as [string, { qs: Record<string, unknown> }];
		expect(secondOpts.qs.pageToken).toBe('page_2');
		expect(items).toHaveLength(2);
		expect(items[0].json).toEqual({ idString: 'link_a' });
		expect(items[1].json).toEqual({ idString: 'link_b' });
	});
});

describe('link update', () => {
	it('throws NodeOperationError and makes no HTTP call when updateFields is empty', async () => {
		const exec = fakeExec(
			{ link: { __rl: true, mode: 'id', value: 'lnk_abc_d' }, updateFields: {} },
			[],
		);

		await expect(run(linkHandlers.update, exec, 0, newCtx())).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('throws NodeOperationError when every updateFields value is empty', async () => {
		const exec = fakeExec(
			{
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				updateFields: { title: '', tags: [], folderId: { __rl: true, mode: 'list', value: '' } },
			},
			[],
		);

		await expect(run(linkHandlers.update, exec, 0, newCtx())).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('sends POST /links/{id} with the built body, including originalURL', async () => {
		const exec = fakeExec(
			{
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				updateFields: { title: 'New title', originalURL: 'https://new.example' },
			},
			[{ statusCode: 200, body: { idString: 'lnk_abc_d', title: 'New title' } }],
		);

		const [item] = await run(linkHandlers.update, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/links/lnk_abc_d',
			body: { title: 'New title', originalURL: 'https://new.example' },
		});
		expect(item.json).toEqual({ idString: 'lnk_abc_d', title: 'New title' });
	});

	it('resolves the link id via GET /links/expand when the locator uses a short URL', async () => {
		const exec = fakeExec(
			{
				link: { __rl: true, mode: 'url', value: 'https://s.gy/abc' },
				updateFields: { title: 'New title' },
			},
			[
				{ statusCode: 200, body: { idString: 'lnk_x_y' } },
				{ statusCode: 200, body: { idString: 'lnk_x_y', title: 'New title' } },
			],
		);

		await run(linkHandlers.update, exec, 0, newCtx());

		const [, expandOpts] = calls(exec)[0] as [string, { qs: unknown }];
		expect(expandOpts).toMatchObject({ qs: { domain: 's.gy', path: 'abc' } });
		const [, updateOpts] = calls(exec)[1] as [string, { url: string }];
		expect(updateOpts.url).toBe('https://api.short.io/links/lnk_x_y');
	});
});

describe('link delete', () => {
	it('sends DELETE /links/{id} and returns {success:true, idString}', async () => {
		const exec = fakeExec({ link: { __rl: true, mode: 'id', value: 'lnk_abc_d' } }, [
			{ statusCode: 200, body: { success: true, idString: 'lnk_abc_d' } },
		]);

		const [item] = await run(linkHandlers.delete, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'DELETE', url: 'https://api.short.io/links/lnk_abc_d' });
		expect(item.json).toEqual({ success: true, idString: 'lnk_abc_d' });
	});
});

describe('link archive', () => {
	it('sends POST /links/archive with {link_id} and returns {success:true, idString}', async () => {
		const exec = fakeExec({ link: { __rl: true, mode: 'id', value: 'lnk_abc_d' } }, [
			{ statusCode: 200, body: { success: true } },
		]);

		const [item] = await run(linkHandlers.archive, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/links/archive',
			body: { link_id: 'lnk_abc_d' },
		});
		expect(item.json).toEqual({ success: true, idString: 'lnk_abc_d' });
	});
});

describe('link unarchive', () => {
	it('sends POST /links/unarchive with {link_id} and returns {success:true, idString}', async () => {
		const exec = fakeExec({ link: { __rl: true, mode: 'id', value: 'lnk_abc_d' } }, [
			{ statusCode: 200, body: { success: true } },
		]);

		const [item] = await run(linkHandlers.unarchive, exec, 0, newCtx());

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/links/unarchive',
			body: { link_id: 'lnk_abc_d' },
		});
		expect(item.json).toEqual({ success: true, idString: 'lnk_abc_d' });
	});
});
