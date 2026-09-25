import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { domainHandlers } from '../nodes/ShortIo/resources/domain/execute';
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

function run(entry: (typeof domainHandlers)[string], exec: IExecuteFunctions, i: number) {
	return (entry.run as ItemHandler).call(exec, i, { domains: undefined as never });
}

describe('domain create', () => {
	it('sends POST /domains with hostname and compacted additional fields', async () => {
		const exec = fakeExec(
			{
				hostname: 'go.example.com',
				additionalFields: { hideReferer: true, linkType: 'secure' },
			},
			[{ statusCode: 200, body: { id: 1, hostname: 'go.example.com' } }],
		);

		const [item] = await run(domainHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({ method: 'POST', url: 'https://api.short.io/domains' });
		expect(opts.body).toEqual({ hostname: 'go.example.com', hideReferer: true, linkType: 'secure' });
		expect(item.json).toEqual({ id: 1, hostname: 'go.example.com' });
	});

	it('omits empty additional fields', async () => {
		const exec = fakeExec({ hostname: 'go.example.com' }, [{ statusCode: 200, body: { id: 1 } }]);

		await run(domainHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { body: unknown }];
		expect(opts.body).toEqual({ hostname: 'go.example.com' });
	});

	it('strips a scheme and trailing slash from a pasted URL', async () => {
		const exec = fakeExec({ hostname: 'https://Go.Example.com/' }, [
			{ statusCode: 200, body: { id: 1 } },
		]);

		await run(domainHandlers.create, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { body: { hostname: string } }];
		expect(opts.body.hostname).toBe('go.example.com');
	});

	it('rejects a hostname with a path', async () => {
		const exec = fakeExec({ hostname: 'go.example.com/path' }, []);

		await expect(run(domainHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an empty hostname', async () => {
		const exec = fakeExec({ hostname: '   ' }, []);

		await expect(run(domainHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it.each([
		['a tab', 'evil\t.com'],
		['a newline', 'evil\n.com'],
		['a carriage return', 'evil\r.com'],
	])('rejects a hostname containing %s and makes no HTTP call', async (_label, hostname) => {
		const exec = fakeExec({ hostname }, []);

		await expect(run(domainHandlers.create, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('domain get', () => {
	it('sends GET /domains/{domainId} with resource "domain" and returns the body', async () => {
		const exec = fakeExec({ domain: { __rl: true, mode: 'id', value: '123' } }, [
			{ statusCode: 200, body: { id: 123, hostname: 'go.example.com' } },
		]);

		const [item] = await run(domainHandlers.get, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/domains/123' });
		expect(item.json).toEqual({ id: 123, hostname: 'go.example.com' });
	});
});

describe('domain update settings', () => {
	it('sends POST /domains/settings/{domainId} with the compacted update fields', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				updateFields: { caseSensitive: true, httpsLevel: 'hsts', webhookURL: '' },
			},
			[{ statusCode: 200, body: {} }],
		);

		const [item] = await run(domainHandlers.updateSettings, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string; body: unknown }];
		expect(opts).toMatchObject({
			method: 'POST',
			url: 'https://api.short.io/domains/settings/123',
		});
		expect(opts.body).toEqual({ caseSensitive: true, httpsLevel: 'hsts' });
		expect(item.json).toEqual({ success: true, domainId: 123 });
	});

	it('merges a non-empty response body into the {success, domainId} result', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				updateFields: { cloaking: true },
			},
			[{ statusCode: 200, body: { updated: true } }],
		);

		const [item] = await run(domainHandlers.updateSettings, exec, 0);

		expect(item.json).toEqual({ success: true, domainId: 123, updated: true });
	});

	it('throws before any HTTP call when updateFields is empty', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' }, updateFields: {} },
			[],
		);

		await expect(run(domainHandlers.updateSettings, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an invalid integrationGTM value and makes no HTTP call', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				updateFields: { integrationGTM: 'not-a-valid-id' },
			},
			[],
		);

		await expect(run(domainHandlers.updateSettings, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('accepts a GTM-prefixed integrationGTM value', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				updateFields: { integrationGTM: 'GTM-ABC123' },
			},
			[{ statusCode: 200, body: {} }],
		);

		await run(domainHandlers.updateSettings, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { body: { integrationGTM: string } }];
		expect(opts.body.integrationGTM).toBe('GTM-ABC123');
	});

	it('sends null for a cleared field, and "" for a cleared Not Found Redirect', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				updateFields: {},
				clearFields: ['segmentKey', 'redirect404'],
			},
			[{ statusCode: 200, body: {} }],
		);

		await run(domainHandlers.updateSettings, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { body: unknown }];
		expect(opts.body).toEqual({ segmentKey: null, redirect404: '' });
	});

	it('treats clearFields alone (no updateFields) as a valid update', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				clearFields: ['webhookURL'],
			},
			[{ statusCode: 200, body: {} }],
		);

		const [item] = await run(domainHandlers.updateSettings, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { body: unknown }];
		expect(opts.body).toEqual({ webhookURL: null });
		expect(item.json).toEqual({ success: true, domainId: 123 });
	});

	it('throws before any HTTP call when both updateFields and clearFields are empty', async () => {
		const exec = fakeExec(
			{ domain: { __rl: true, mode: 'id', value: '123' }, updateFields: {}, clearFields: [] },
			[],
		);

		await expect(run(domainHandlers.updateSettings, exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('throws when a field is both set in updateFields and selected in clearFields', async () => {
		const exec = fakeExec(
			{
				domain: { __rl: true, mode: 'id', value: '123' },
				updateFields: { segmentKey: 'abc' },
				clearFields: ['segmentKey'],
			},
			[],
		);

		await expect(run(domainHandlers.updateSettings, exec, 0)).rejects.toThrow(
			/segmentKey.*Update Fields.*Clear Fields/,
		);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});
});

describe('domain get many', () => {
	it('still sends GET /api/domains with filters (unchanged by task 19)', async () => {
		const exec = fakeExec({ returnAll: false, limit: 50, filters: {} }, [
			{ statusCode: 200, body: [{ id: 1, hostname: 'a.example.com' }] },
		]);

		const items = await run(domainHandlers.getMany, exec, 0);

		const [, opts] = calls(exec)[0] as [string, { method: string; url: string }];
		expect(opts).toMatchObject({ method: 'GET', url: 'https://api.short.io/api/domains' });
		expect(items).toHaveLength(1);
	});
});
