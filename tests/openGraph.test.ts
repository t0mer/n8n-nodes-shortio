import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { linkOpenGraphHandlers } from '../nodes/ShortIo/resources/linkOpenGraph/execute';
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

function run(entry: (typeof linkOpenGraphHandlers)[string], exec: IExecuteFunctions, i: number) {
	return (entry.run as ItemHandler).call(exec, i, newCtx());
}

describe('link opengraph get', () => {
	it('sends GET /links/opengraph/{domainId}/{linkId} and maps pairs to properties', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
			},
			[
				{
					statusCode: 200,
					body: [
						['title', 'My title'],
						['description', 'My description'],
					],
				},
			],
		);

		const [item] = await run(linkOpenGraphHandlers.get, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'GET',
			url: 'https://api.short.io/links/opengraph/123/lnk_abc_d',
		});
		expect(item.json).toEqual({
			properties: { title: 'My title', description: 'My description' },
			raw: [
				['title', 'My title'],
				['description', 'My description'],
			],
		});
	});

	it('outputs empty properties and the raw response when the API returns a non-array body', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
			},
			[{ statusCode: 200, body: { error: 'unexpected' } }],
		);

		const [item] = await run(linkOpenGraphHandlers.get, exec, 0);

		expect(item.json).toEqual({ properties: {}, raw: { error: 'unexpected' } });
	});
});

describe('link opengraph set', () => {
	it('sends PUT with a body of [key, value] tuples', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				properties: {
					property: [
						{ key: 'title', value: 'My title' },
						{ key: 'description', value: 'My description' },
					],
				},
			},
			[{ statusCode: 200, body: {} }],
		);

		const [item] = await run(linkOpenGraphHandlers.set, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'PUT',
			url: 'https://api.short.io/links/opengraph/123/lnk_abc_d',
			body: [
				['title', 'My title'],
				['description', 'My description'],
			],
		});
		expect(item.json).toEqual({ success: true });
	});

	it('merges a non-empty response body into the output', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				properties: { property: [{ key: 'title', value: 'My title' }] },
			},
			[{ statusCode: 200, body: { updated: true } }],
		);

		const [item] = await run(linkOpenGraphHandlers.set, exec, 0);

		expect(item.json).toEqual({ success: true, updated: true });
	});

	it('throws NodeOperationError and makes no HTTP call when no properties are given', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
				properties: {},
			},
			[],
		);

		await expect(run(linkOpenGraphHandlers.set, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});
