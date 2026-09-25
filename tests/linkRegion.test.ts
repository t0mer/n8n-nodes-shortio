import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';

import { getRegions } from '../nodes/ShortIo/methods/loadOptions';
import { linkRegionHandlers } from '../nodes/ShortIo/resources/linkRegion/execute';
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

function calls(exec: IExecuteFunctions | ILoadOptionsFunctions) {
	return (exec.helpers.httpRequestWithAuthentication as unknown as { mock: { calls: unknown[][] } })
		.mock.calls;
}

function run(entry: (typeof linkRegionHandlers)[string], exec: IExecuteFunctions, i: number) {
	return (entry.run as ItemHandler).call(exec, i, newCtx());
}

const LINK = { __rl: true, mode: 'id', value: 'lnk_abc_d' };

describe('link region create', () => {
	it('sends POST /link_region/{linkId} with {country, region, originalURL}', async () => {
		const exec = fakeExec(
			{ link: LINK, country: 'us', region: 'CA', originalURL: 'https://example.com/ca' },
			[{ statusCode: 200, body: { country: 'US', region: 'CA', originalURL: 'https://example.com/ca' } }],
		);

		const [item] = await run(linkRegionHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/link_region/lnk_abc_d',
			body: { country: 'US', region: 'CA', originalURL: 'https://example.com/ca' },
		});
		expect(item.json).toEqual({ country: 'US', region: 'CA', originalURL: 'https://example.com/ca' });
	});

	it('returns {success: true} when the response body is empty', async () => {
		const exec = fakeExec(
			{ link: LINK, country: 'US', region: 'CA', originalURL: 'https://example.com/ca' },
			[{ statusCode: 200, body: {} }],
		);

		const [item] = await run(linkRegionHandlers.create, exec, 0);

		expect(item.json).toEqual({ success: true });
	});

	it('rejects an invalid country code and makes no HTTP call', async () => {
		const exec = fakeExec(
			{ link: LINK, country: '../../etc/passwd', region: 'CA', originalURL: 'https://example.com' },
			[],
		);

		await expect(run(linkRegionHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an invalid region code (e.g. a path-traversal-shaped value) and makes no HTTP call', async () => {
		const exec = fakeExec(
			{ link: LINK, country: 'US', region: '../..', originalURL: 'https://example.com' },
			[],
		);

		await expect(run(linkRegionHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects a missing Original URL and makes no HTTP call', async () => {
		const exec = fakeExec({ link: LINK, country: 'US', region: 'CA', originalURL: '' }, []);

		await expect(run(linkRegionHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('link region create many', () => {
	it('sends POST /link_region/bulk/{linkId} with a bare array body', async () => {
		const exec = fakeExec(
			{
				link: LINK,
				targets: {
					target: [
						{ country: 'US', region: 'CA', originalURL: 'https://example.com/ca' },
						{ country: 'gb', region: 'ENG', originalURL: 'https://example.com/eng' },
					],
				},
			},
			[
				{
					statusCode: 200,
					body: [
						{ country: 'US', region: 'CA', originalURL: 'https://example.com/ca' },
						{ country: 'GB', region: 'ENG', originalURL: 'https://example.com/eng' },
					],
				},
			],
		);

		const items = await run(linkRegionHandlers.createMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/link_region/bulk/lnk_abc_d',
		});
		expect(opts.body).toEqual([
			{ country: 'US', region: 'CA', originalURL: 'https://example.com/ca' },
			{ country: 'GB', region: 'ENG', originalURL: 'https://example.com/eng' },
		]);
		expect(items).toHaveLength(2);
	});

	it('throws before any HTTP call when the target list is empty', async () => {
		const exec = fakeExec({ link: LINK, targets: {} }, []);

		await expect(run(linkRegionHandlers.createMany, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an invalid region code within a target and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				link: LINK,
				targets: { target: [{ country: 'US', region: '../etc', originalURL: 'https://example.com' }] },
			},
			[],
		);

		await expect(run(linkRegionHandlers.createMany, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('link region delete', () => {
	it('sends DELETE /link_region/{linkId}/{country}/{region} and returns {success:true, ...response}', async () => {
		const exec = fakeExec(
			{ link: LINK, country: 'US', region: 'CA' },
			[{ statusCode: 200, body: { deleted: true } }],
		);

		const [item] = await run(linkRegionHandlers.delete, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({
			method: 'DELETE',
			url: 'https://api.short.io/link_region/lnk_abc_d/US/CA',
		});
		expect(item.json).toEqual({ success: true, deleted: true });
	});

	it('rejects an invalid region code and makes no HTTP call', async () => {
		const exec = fakeExec({ link: LINK, country: 'US', region: 'toolong' }, []);

		await expect(run(linkRegionHandlers.delete, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('link region get many', () => {
	it('sends GET /link_region/{linkId} and returns one item per entry', async () => {
		const exec = fakeExec(
			{ link: LINK },
			[
				{
					statusCode: 200,
					body: [
						{ country: 'US', region: 'CA', originalURL: 'https://example.com/ca' },
						{ country: 'US', region: 'NY', originalURL: 'https://example.com/ny' },
					],
				},
			],
		);

		const items = await run(linkRegionHandlers.getMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/link_region/lnk_abc_d' });
		expect(items).toHaveLength(2);
	});

	it('returns no items for a bare empty array response', async () => {
		const exec = fakeExec({ link: LINK }, [{ statusCode: 200, body: [] }]);

		const items = await run(linkRegionHandlers.getMany, exec, 0);

		expect(items).toEqual([]);
	});
});

describe('link region get regions for country', () => {
	it('sends GET /link_region/list/{country} and returns one item per region', async () => {
		const exec = fakeExec(
			{ country: 'US' },
			[
				{
					statusCode: 200,
					body: [
						{ id: 'AL', name: 'Alabama' },
						{ id: 'CA', name: 'California' },
					],
				},
			],
		);

		const items = await run(linkRegionHandlers.getRegionsForCountry, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/link_region/list/US' });
		expect(items).toHaveLength(2);
		expect(items[0].json).toEqual({ id: 'AL', name: 'Alabama' });
	});

	it('rejects an invalid country code and makes no HTTP call', async () => {
		const exec = fakeExec({ country: '../../links' }, []);

		await expect(run(linkRegionHandlers.getRegionsForCountry, exec, 0)).rejects.toThrow(
			NodeOperationError,
		);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('getRegions (loadOptions)', () => {
	function fakeLoadOptions(
		country: unknown,
		responses: Resp[],
	): ILoadOptionsFunctions {
		return fakeCtx(responses, {
			getCurrentNodeParameter: (name: string) => (name === 'country' ? country : undefined),
		}) as unknown as ILoadOptionsFunctions;
	}

	it('returns [] without a country', async () => {
		const ctx = fakeLoadOptions(undefined, []);

		const options = await getRegions.call(ctx);

		expect(options).toEqual([]);
		expect(ctx.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('returns [] for an invalid country', async () => {
		const ctx = fakeLoadOptions('../../etc', []);

		const options = await getRegions.call(ctx);

		expect(options).toEqual([]);
		expect(ctx.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('sends GET /link_region/list/{country} and returns options sorted by name', async () => {
		const ctx = fakeLoadOptions('us', [
			{
				statusCode: 200,
				body: [
					{ id: 'CA', name: 'California' },
					{ id: 'AL', name: 'Alabama' },
				],
			},
		]);

		const options = await getRegions.call(ctx);

		const [, opts] = calls(ctx)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/link_region/list/US' });
		expect(options).toEqual([
			{ name: 'Alabama (AL)', value: 'AL' },
			{ name: 'California (CA)', value: 'CA' },
		]);
	});
});
