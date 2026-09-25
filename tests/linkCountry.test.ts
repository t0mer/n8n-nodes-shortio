import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { linkCountryHandlers } from '../nodes/ShortIo/resources/linkCountry/execute';
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

function run(entry: (typeof linkCountryHandlers)[string], exec: IExecuteFunctions, i: number) {
	return (entry.run as ItemHandler).call(exec, i, newCtx());
}

const LINK = { __rl: true, mode: 'id', value: 'lnk_abc_d' };

describe('link country create', () => {
	it('sends POST /link_country/{linkId} with {country, originalURL}', async () => {
		const exec = fakeExec(
			{ link: LINK, country: 'us', originalURL: 'https://example.com/us' },
			[{ statusCode: 200, body: { country: 'US', originalURL: 'https://example.com/us' } }],
		);

		const [item] = await run(linkCountryHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/link_country/lnk_abc_d',
			body: { country: 'US', originalURL: 'https://example.com/us' },
		});
		expect(item.json).toEqual({ country: 'US', originalURL: 'https://example.com/us' });
	});

	it('returns {success: true} when the response body is empty', async () => {
		const exec = fakeExec(
			{ link: LINK, country: 'US', originalURL: 'https://example.com/us' },
			[{ statusCode: 200, body: {} }],
		);

		const [item] = await run(linkCountryHandlers.create, exec, 0);

		expect(item.json).toEqual({ success: true });
	});

	it('rejects an invalid country code (e.g. a path-traversal-shaped value) and makes no HTTP call', async () => {
		const exec = fakeExec(
			{ link: LINK, country: '../../links', originalURL: 'https://example.com' },
			[],
		);

		await expect(run(linkCountryHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects a missing Original URL and makes no HTTP call', async () => {
		const exec = fakeExec({ link: LINK, country: 'US', originalURL: '' }, []);

		await expect(run(linkCountryHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('link country create many', () => {
	it('sends POST /link_country/bulk/{linkId} with a bare array body', async () => {
		const exec = fakeExec(
			{
				link: LINK,
				targets: {
					target: [
						{ country: 'US', originalURL: 'https://example.com/us' },
						{ country: 'gb', originalURL: 'https://example.com/gb' },
					],
				},
			},
			[
				{
					statusCode: 200,
					body: [
						{ country: 'US', originalURL: 'https://example.com/us' },
						{ country: 'GB', originalURL: 'https://example.com/gb' },
					],
				},
			],
		);

		const items = await run(linkCountryHandlers.createMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/link_country/bulk/lnk_abc_d',
		});
		expect(opts.body).toEqual([
			{ country: 'US', originalURL: 'https://example.com/us' },
			{ country: 'GB', originalURL: 'https://example.com/gb' },
		]);
		expect(items).toHaveLength(2);
	});

	it('throws before any HTTP call when the target list is empty', async () => {
		const exec = fakeExec({ link: LINK, targets: {} }, []);

		await expect(run(linkCountryHandlers.createMany, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an invalid country code within a target and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				link: LINK,
				targets: { target: [{ country: '../../etc/passwd', originalURL: 'https://example.com' }] },
			},
			[],
		);

		await expect(run(linkCountryHandlers.createMany, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('link country delete', () => {
	it('sends DELETE /link_country/{linkId}/{country} and returns {success:true, ...response}', async () => {
		const exec = fakeExec({ link: LINK, country: 'US' }, [{ statusCode: 200, body: { deleted: true } }]);

		const [item] = await run(linkCountryHandlers.delete, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'DELETE',
			url: 'https://api.short.io/link_country/lnk_abc_d/US',
		});
		expect(item.json).toEqual({ success: true, deleted: true });
	});

	it('rejects an invalid country code and makes no HTTP call', async () => {
		const exec = fakeExec({ link: LINK, country: '1x' }, []);

		await expect(run(linkCountryHandlers.delete, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('link country get many', () => {
	it('sends GET /link_country/{linkId} and returns one item per entry', async () => {
		const exec = fakeExec(
			{ link: LINK },
			[
				{
					statusCode: 200,
					body: [
						{ country: 'US', originalURL: 'https://example.com/us' },
						{ country: 'GB', originalURL: 'https://example.com/gb' },
					],
				},
			],
		);

		const items = await run(linkCountryHandlers.getMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/link_country/lnk_abc_d' });
		expect(items).toHaveLength(2);
	});

	it('returns no items for a bare empty array response', async () => {
		const exec = fakeExec({ link: LINK }, [{ statusCode: 200, body: [] }]);

		const items = await run(linkCountryHandlers.getMany, exec, 0);

		expect(items).toEqual([]);
	});
});
