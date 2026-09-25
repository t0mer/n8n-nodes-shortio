import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeOperationError, sleep } from 'n8n-workflow';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { generateQrCode, generateQrCodesMany } from '../nodes/ShortIo/resources/link/qr';
import { DomainCache } from '../shared/locators';
import type { ExecContext } from '../shared/types';
import { fakeCtx, type Resp } from './helpers';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

beforeEach(() => {
	vi.mocked(sleep).mockClear();
});

function fakeExec(params: Record<string, unknown>, responses: Resp[]): IExecuteFunctions {
	return fakeCtx(responses, {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		continueOnFail: () => false,
	}) as unknown as IExecuteFunctions;
}

function authCalls(exec: IExecuteFunctions) {
	return (
		exec.helpers.httpRequestWithAuthentication as unknown as {
			mock: { calls: Array<[string, { method: string; url: string; body?: unknown }]> };
		}
	).mock.calls.map(([, opts]) => opts);
}

function directCalls(exec: IExecuteFunctions) {
	return (
		exec.helpers.httpRequest as unknown as {
			mock: { calls: Array<[{ method: string; url: string; encoding?: string }]> };
		}
	).mock.calls.map(([opts]) => opts);
}

function mockDownload(exec: IExecuteFunctions, value: { body: unknown; headers?: Record<string, string> }) {
	(
		exec.helpers.httpRequest as unknown as { mockResolvedValueOnce: (v: unknown) => void }
	).mockResolvedValueOnce(value);
}

const link = (id: string) => ({ __rl: true, mode: 'id', value: id });
const domain = (id: string) => ({ __rl: true, mode: 'id', value: id });

describe('link generate QR code', () => {
	it('downloads a {url} response without credentials and builds the binary from it', async () => {
		const exec = fakeExec(
			{ link: link('lnk_abc_d'), options: { color: '#FF0000', type: 'svg' } },
			[{ statusCode: 200, body: { url: 'https://shortiougc.com/qr-code-link/s.gy/lnk_abc_d' } }],
		);
		mockDownload(exec, {
			body: Buffer.from('<svg></svg>'),
			headers: { 'content-type': 'image/svg+xml' },
		});

		const [item] = await generateQrCode.call(exec, 0);

		expect(authCalls(exec)).toEqual([
			expect.objectContaining({
				method: 'POST',
				url: 'https://api.short.io/links/qr/lnk_abc_d',
				body: { color: 'FF0000', type: 'svg', useDomainSettings: true }, // '#' stripped for the API
			}),
		]);

		// The image download goes through plain httpRequest, never httpRequestWithAuthentication.
		expect(exec.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(exec.helpers.httpRequest).toHaveBeenCalledTimes(1);
		expect(directCalls(exec)[0]).toMatchObject({
			method: 'GET',
			url: 'https://shortiougc.com/qr-code-link/s.gy/lnk_abc_d',
			encoding: 'arraybuffer',
		});

		expect(item.json).toEqual({
			idString: 'lnk_abc_d',
			url: 'https://shortiougc.com/qr-code-link/s.gy/lnk_abc_d',
			type: 'svg',
			requestedType: 'svg',
		});
		expect(item.binary?.data).toMatchObject({ fileName: 'qr-lnk_abc_d.svg', mimeType: 'image/svg+xml' });
	});

	it('sends only useDomainSettings (default true) when no options are set', async () => {
		const exec = fakeExec({ link: link('lnk_x_y') }, [
			{ statusCode: 200, body: { url: 'https://shortiougc.com/qr-code-link/s.gy/lnk_x_y' } },
		]);
		mockDownload(exec, { body: Buffer.from('png-bytes'), headers: { 'content-type': 'image/png' } });

		await generateQrCode.call(exec, 0);

		expect(authCalls(exec)[0].body).toEqual({ useDomainSettings: true });
	});

	it('rejects a non-HTTPS QR url and never downloads it', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d') }, [
			{ statusCode: 200, body: { url: 'http://shortiougc.com/qr-code-link/s.gy/lnk_abc_d' } },
		]);

		await expect(generateQrCode.call(exec, 0)).rejects.toThrow(NodeOperationError);
		expect(exec.helpers.httpRequest).not.toHaveBeenCalled();
	});

	it('rejects a QR url on a host other than shortiougc.com and never downloads it', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d') }, [
			{ statusCode: 200, body: { url: 'https://evil.example/qr-code-link/s.gy/lnk_abc_d' } },
		]);

		const error = (await generateQrCode.call(exec, 0).catch((e: unknown) => e)) as NodeOperationError;
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toMatch(/evil\.example/);
		expect(exec.helpers.httpRequest).not.toHaveBeenCalled();
	});

	it('accepts a shortiougc.com subdomain host', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d') }, [
			{ statusCode: 200, body: { url: 'https://cdn.shortiougc.com/qr-code-link/s.gy/lnk_abc_d' } },
		]);
		mockDownload(exec, { body: Buffer.from('png-bytes'), headers: { 'content-type': 'image/png' } });

		const [item] = await generateQrCode.call(exec, 0);

		expect(item.json.url).toBe('https://cdn.shortiougc.com/qr-code-link/s.gy/lnk_abc_d');
	});

	it('rejects a QR url that embeds credentials and never downloads it', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d') }, [
			{ statusCode: 200, body: { url: 'https://user:pass@shortiougc.com/qr-code-link/s.gy/lnk_abc_d' } },
		]);

		const error = (await generateQrCode.call(exec, 0).catch((e: unknown) => e)) as NodeOperationError;
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(exec.helpers.httpRequest).not.toHaveBeenCalled();
	});

	it('rejects a response with no string url', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d') }, [{ statusCode: 200, body: { ok: true } }]);

		const error = (await generateQrCode.call(exec, 0).catch((e: unknown) => e)) as NodeOperationError;
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toMatch(/Unexpected QR code response from Short\.io/);
		expect(exec.helpers.httpRequest).not.toHaveBeenCalled();
	});

	it('rejects an empty binaryPropertyName without calling the API', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d'), binaryPropertyName: '   ' }, []);

		const error = (await generateQrCode.call(exec, 0).catch((e: unknown) => e)) as NodeOperationError;
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toMatch(/Binary Property must not be empty/);
		expect(exec.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('falls back to the requested type for the MIME/extension when no content-type header is present', async () => {
		const exec = fakeExec({ link: link('lnk_abc_d'), options: { type: 'svg' } }, [
			{ statusCode: 200, body: { url: 'https://shortiougc.com/qr-code-link/s.gy/lnk_abc_d' } },
		]);
		mockDownload(exec, { body: Buffer.from('<svg></svg>') });

		const [item] = await generateQrCode.call(exec, 0);

		expect(item.binary?.data).toMatchObject({ fileName: 'qr-lnk_abc_d.svg', mimeType: 'image/svg+xml' });
	});

	it('respects a custom binaryPropertyName', async () => {
		const exec = fakeExec(
			{ link: link('lnk_abc_d'), binaryPropertyName: ' qrImage ' },
			[{ statusCode: 200, body: { url: 'https://shortiougc.com/qr-code-link/s.gy/lnk_abc_d' } }],
		);
		mockDownload(exec, { body: Buffer.from('png-bytes'), headers: { 'content-type': 'image/png' } });

		const [item] = await generateQrCode.call(exec, 0);

		expect(item.binary?.qrImage).toBeDefined();
		expect(item.binary?.data).toBeUndefined();
	});
});

describe('link generate QR codes many', () => {
	function fakeManyExec(
		perItem: Array<Record<string, unknown>>,
		globalParams: Record<string, unknown>,
		responses: Resp[],
		continueOnFail = false,
	): IExecuteFunctions {
		return fakeCtx(responses, {
			getNodeParameter: (name: string, i: number, fallback?: unknown) => {
				if (name === 'domain' || name === 'options') {
					return globalParams[name] !== undefined ? globalParams[name] : fallback;
				}
				const value = perItem[i]?.[name];
				if (value instanceof Error) throw value;
				return value !== undefined ? value : fallback;
			},
			continueOnFail: () => continueOnFail,
		}) as unknown as IExecuteFunctions;
	}

	function runMany(count: number, exec: IExecuteFunctions) {
		const items: INodeExecutionData[] = Array.from({ length: count }, () => ({ json: {} }));
		const ctx: ExecContext = { domains: new DomainCache() };
		return generateQrCodesMany.call(exec, items, ctx);
	}

	it('chunks 151 items into 2 requests and 2 output items with array pairedItem', async () => {
		// The API declares `application/json` for this endpoint even though the body is a ZIP (per
		// the digest); the node must hardcode application/zip rather than trust this header.
		const perItem = Array.from({ length: 151 }, (_, i) => ({ link: link(`link_${i}`) }));
		const exec = fakeManyExec(perItem, { domain: domain('1') }, [
			{ statusCode: 201, body: Buffer.from('zip-1'), headers: { 'content-type': 'application/json' } },
			{ statusCode: 201, body: Buffer.from('zip-2'), headers: { 'content-type': 'application/json' } },
		]);

		const out = await runMany(151, exec);

		const bulkCalls = authCalls(exec).filter((c) => c.url.endsWith('/links/qr/bulk'));
		expect(bulkCalls).toHaveLength(2);
		expect((bulkCalls[0].body as { linkIds: string[] }).linkIds).toHaveLength(150);
		expect(bulkCalls[0].body).toMatchObject({ domainId: '1', type: 'png', useDomainSettings: true });
		expect((bulkCalls[1].body as { linkIds: string[] }).linkIds).toEqual(['link_150']);
		expect(sleep).not.toHaveBeenCalled();

		expect(out).toHaveLength(2);
		expect(out[0].pairedItem).toEqual(Array.from({ length: 150 }, (_, i) => ({ item: i })));
		expect(out[0].json).toEqual({ linkIds: perItem.slice(0, 150).map((_, i) => `link_${i}`), count: 150 });
		expect(out[0].binary?.data).toMatchObject({ fileName: 'qr-codes-1.zip', mimeType: 'application/zip' });
		expect(out[1].pairedItem).toEqual([{ item: 150 }]);
		expect(out[1].binary?.data).toMatchObject({ fileName: 'qr-codes-2.zip', mimeType: 'application/zip' });
	});

	it('sends the domain, type, and extra options from item 0 to every chunk', async () => {
		const perItem = [{ link: link('link_a') }, { link: link('link_b') }];
		const exec = fakeManyExec(
			perItem,
			{ domain: domain('5'), options: { color: '#ABCDEF', noExcavate: true, type: 'svg' } },
			[{ statusCode: 201, body: Buffer.from('zip'), headers: { 'content-type': 'application/zip' } }],
		);

		await runMany(2, exec);

		expect(authCalls(exec)[0].body).toEqual({
			linkIds: ['link_a', 'link_b'],
			domainId: '5',
			type: 'svg',
			useDomainSettings: true,
			color: 'ABCDEF',
			noExcavate: true,
		});
	});

	it('with continue-on-fail, an invalid link id becomes an error item and the rest still produce a ZIP', async () => {
		const perItem = [{ link: link('link_a') }, { link: link('nope') }];
		const exec = fakeManyExec(
			perItem,
			{ domain: domain('1') },
			[{ statusCode: 201, body: Buffer.from('zip'), headers: { 'content-type': 'application/zip' } }],
			true,
		);

		const out = await runMany(2, exec);

		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({
			json: { error: '"nope" is not a valid link ID' },
			pairedItem: { item: 1 },
		});
		expect(out[1].pairedItem).toEqual([{ item: 0 }]);
		expect(out[1].binary?.data).toMatchObject({ fileName: 'qr-codes-1.zip' });
		expect(authCalls(exec)[0].body).toMatchObject({ linkIds: ['link_a'] });
	});

	it('without continue-on-fail, an invalid link id throws before any request', async () => {
		const perItem = [{ link: link('link_a') }, { link: link('nope') }];
		const exec = fakeManyExec(perItem, { domain: domain('1') }, []);

		const error = (await runMany(2, exec).catch((e: unknown) => e)) as NodeOperationError;

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.context.itemIndex).toBe(1);
		expect(authCalls(exec)).toHaveLength(0);
	});

	it('with continue-on-fail, a failed whole chunk marks every item in it', async () => {
		const perItem = [{ link: link('link_a') }, { link: link('link_b') }];
		const exec = fakeManyExec(
			perItem,
			{ domain: domain('1') },
			[{ statusCode: 400, body: { error: 'Invalid body' } }],
			true,
		);

		const out = await runMany(2, exec);

		expect(out).toEqual([
			{ json: { error: 'Short.io error: Invalid body', statusCode: 400 }, pairedItem: { item: 0 } },
			{ json: { error: 'Short.io error: Invalid body', statusCode: 400 }, pairedItem: { item: 1 } },
		]);
	});

	it('rejects an invalid domain before reading any link parameter', async () => {
		const perItem = [{ link: link('link_a') }];
		const exec = fakeManyExec(perItem, { domain: domain('abc') }, []);

		const error = (await runMany(1, exec).catch((e: unknown) => e)) as NodeOperationError;

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.context.itemIndex).toBe(0);
		expect(authCalls(exec)).toHaveLength(0);
	});
});
