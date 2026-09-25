import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { linkPermissionHandlers } from '../nodes/ShortIo/resources/linkPermission/execute';
import { DomainCache } from '../shared/locators';
import type { ExecContext, ItemHandler } from '../shared/types';
import { fakeCtx, type Resp } from './helpers';

function newCtx(): ExecContext {
	return { domains: new DomainCache() };
}

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

function run(entry: (typeof linkPermissionHandlers)[string], exec: IExecuteFunctions, i: number) {
	return (entry.run as ItemHandler).call(exec, i, newCtx());
}

describe('link permission add', () => {
	it('sends POST /links/permissions/{domainId}/{linkId}/{userId} and returns the response body', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: 42,
			},
			[
				{
					statusCode: 201,
					body: { id: 'perm_1', DomainId: 123, UserId: 42, LinkIdString: 'lnk_abc_d' },
				},
			],
		);

		const [item] = await run(linkPermissionHandlers.add, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/links/permissions/123/lnk_abc_d/42',
		});
		expect(item.json).toEqual({ id: 'perm_1', DomainId: 123, UserId: 42, LinkIdString: 'lnk_abc_d' });
	});

	it('rejects a non-numeric userId (e.g. a path-traversal expression value) and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: '42/../../../../links/lnk_victim',
			},
			[],
		);

		await expect(run(linkPermissionHandlers.add, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects a zero or negative userId', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: -1,
			},
			[],
		);

		await expect(run(linkPermissionHandlers.add, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it("names both the link and the user on a 404, since either could be the missing one", async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: 42,
			},
			[{ statusCode: 404, body: { error: 'Not found' } }],
		);

		await expect(run(linkPermissionHandlers.add, exec, 0)).rejects.toThrow(/link or user was not found/i);
	});
});

describe('link permission delete', () => {
	it('sends DELETE /links/permissions/{domainId}/{linkId}/{userId} and returns the response body', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: 42,
			},
			[{ statusCode: 201, body: { success: true } }],
		);

		const [item] = await run(linkPermissionHandlers.delete, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'DELETE',
			url: 'https://api.short.io/links/permissions/123/lnk_abc_d/42',
		});
		expect(item.json).toEqual({ success: true });
	});

	it('returns {success: true} when the response body is empty', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: 42,
			},
			[{ statusCode: 201, body: {} }],
		);

		const [item] = await run(linkPermissionHandlers.delete, exec, 0);

		expect(item.json).toEqual({ success: true });
	});

	it('rejects a non-numeric userId and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: '42/../../links',
			},
			[],
		);

		await expect(run(linkPermissionHandlers.delete, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it("names both the link and the user on a 404, since either could be the missing one", async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				userId: 42,
			},
			[{ statusCode: 404, body: { error: 'Not found' } }],
		);

		await expect(run(linkPermissionHandlers.delete, exec, 0)).rejects.toThrow(/link or user was not found/i);
	});
});

describe('link permission get many', () => {
	it('sends GET /links/permissions/{domainId}/{linkId} and returns one item per entry', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
			},
			[
				{
					statusCode: 200,
					body: [
						{ id: 'perm_1', DomainId: 123, UserId: 42, LinkIdString: 'lnk_abc_d' },
						{ id: 'perm_2', DomainId: 123, UserId: 43, LinkIdString: 'lnk_abc_d' },
					],
				},
			],
		);

		const items = await run(linkPermissionHandlers.getMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'GET',
			url: 'https://api.short.io/links/permissions/123/lnk_abc_d',
		});
		expect(items).toHaveLength(2);
		expect(items[0].json).toEqual({ id: 'perm_1', DomainId: 123, UserId: 42, LinkIdString: 'lnk_abc_d' });
		expect(items[1].json).toEqual({ id: 'perm_2', DomainId: 123, UserId: 43, LinkIdString: 'lnk_abc_d' });
	});

	it('returns no items for a bare empty array response', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
			},
			[{ statusCode: 200, body: [] }],
		);

		const items = await run(linkPermissionHandlers.getMany, exec, 0);

		expect(items).toEqual([]);
	});
});
