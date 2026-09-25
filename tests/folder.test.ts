import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { folderHandlers } from '../nodes/ShortIo/resources/folder/execute';
import type { ItemHandler } from '../shared/types';
import { fakeCtx, type Resp } from './helpers';

function fakeExec(params: Record<string, unknown>, responses: Resp[]): IExecuteFunctions {
	return fakeCtx(responses, {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		continueOnFail: () => false,
	}) as unknown as IExecuteFunctions;
}

function calls(exec: IExecuteFunctions) {
	return (exec.helpers.httpRequestWithAuthentication as unknown as { mock: { calls: unknown[][] } })
		.mock.calls;
}

function run(entry: (typeof folderHandlers)[string], exec: IExecuteFunctions, i: number) {
	return (entry.run as ItemHandler).call(exec, i, { domains: undefined as never });
}

describe('folder create', () => {
	it('sends POST /links/folders with domainId, name, and compacted additional fields', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				name: 'My Folder',
				additionalFields: {
					backgroundColor: '#FFFFFF',
					color: '#123ABC',
					integrationFB: 'fb-1',
					redirectType: '301',
				},
			},
			[{ statusCode: 200, body: { id: 'fol_1', domainId: 123, name: 'My Folder' } }],
		);

		const [item] = await run(folderHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({ method: 'POST', url: 'https://api.short.io/links/folders' });
		expect(opts.body).toEqual({
			domainId: 123,
			name: 'My Folder',
			backgroundColor: 'FFFFFF',
			color: '123ABC',
			integrationFB: 'fb-1',
			redirectType: 301,
		});
		expect(item.json).toEqual({ id: 'fol_1', domainId: 123, name: 'My Folder' });
	});

	it('omits empty additional fields entirely', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				name: 'Bare Folder',
			},
			[{ statusCode: 200, body: { id: 'fol_2' } }],
		);

		await run(folderHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { body: unknown }];
		expect(opts.body).toEqual({ domainId: 123, name: 'Bare Folder' });
	});
});

describe('folder get', () => {
	it('sends GET /links/folders/{domainId}/{folderId} and returns the response body', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				folder: { __rl: true, mode: 'id', value: 'abc-123' },
			},
			[{ statusCode: 200, body: { id: 'abc-123', name: 'My Folder' } }],
		);

		const [item] = await run(folderHandlers.get, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'GET',
			url: 'https://api.short.io/links/folders/123/abc-123',
		});
		expect(item.json).toEqual({ id: 'abc-123', name: 'My Folder' });
	});

	it('rejects an invalid folder id (e.g. a path-traversal expression value) and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				folder: { __rl: true, mode: 'id', value: '../../../links/lnk_victim' },
			},
			[],
		);

		await expect(run(folderHandlers.get, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an empty folder id and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				folder: { __rl: true, mode: 'id', value: '' },
			},
			[],
		);

		await expect(run(folderHandlers.get, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('encodeURIComponent-encodes a folder id containing characters like a slash', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				// Passes the resolveFolderId regex (letters, digits, underscore, hyphen) but is still
				// run through encodeURIComponent to prove the URL-building step isn't skipped.
				folder: { __rl: true, mode: 'id', value: 'abc-def_123' },
			},
			[{ statusCode: 200, body: { id: 'abc-def_123' } }],
		);

		await run(folderHandlers.get, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { url: string }];
		expect(opts.url).toBe('https://api.short.io/links/folders/123/abc-def_123');
	});
});

describe('folder get many', () => {
	it('sends GET /links/folders/{domainId} and returns one item per linkFolders entry', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' } },
			[
				{
					statusCode: 200,
					body: { linkFolders: [{ id: 'fol_1', name: 'A' }, { id: 'fol_2', name: 'B' }] },
				},
			],
		);

		const items = await run(folderHandlers.getMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/links/folders/123' });
		expect(items).toHaveLength(2);
		expect(items[0].json).toEqual({ id: 'fol_1', name: 'A' });
		expect(items[1].json).toEqual({ id: 'fol_2', name: 'B' });
	});

	it('returns no items for an empty linkFolders envelope', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' } },
			[{ statusCode: 200, body: { linkFolders: [] } }],
		);

		const items = await run(folderHandlers.getMany, exec, 0);

		expect(items).toEqual([]);
	});

	it('accepts a bare array response defensively', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' } },
			[{ statusCode: 200, body: [{ id: 'fol_1', name: 'A' }] }],
		);

		const items = await run(folderHandlers.getMany, exec, 0);

		expect(items).toHaveLength(1);
		expect(items[0].json).toEqual({ id: 'fol_1', name: 'A' });
	});
});
