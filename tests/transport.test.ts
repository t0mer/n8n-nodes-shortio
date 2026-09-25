import { describe, it, expect, vi } from 'vitest';
import { sleep, NodeApiError } from 'n8n-workflow';
import { shortIoRequest, retryDelayMs, MAX_ATTEMPTS, HOSTS } from '../shared/transport';
import { fakeCtx } from './helpers';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

describe('shortIoRequest', () => {
	it('builds api host url, passes qs/body, returns body', async () => {
		const ctx = fakeCtx([{ statusCode: 200, body: { ok: 1 } }]);
		const out = await shortIoRequest.call(ctx, {
			method: 'POST',
			path: '/links',
			body: { a: 1 },
			qs: { x: 'y' },
		});
		expect(out).toEqual({ ok: 1 });
		const [cred, opts] = ctx.helpers.httpRequestWithAuthentication.mock.calls[0];
		expect(cred).toBe('shortIoApi');
		expect(opts).toMatchObject({
			method: 'POST',
			url: `${HOSTS.api}/links`,
			body: { a: 1 },
			qs: { x: 'y' },
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
	});

	it('uses statistics host', async () => {
		const ctx = fakeCtx([{ statusCode: 200, body: {} }]);
		await shortIoRequest.call(ctx, { method: 'GET', host: 'statistics', path: '/domain/1' });
		expect(ctx.helpers.httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
			'https://statistics.short.io/statistics/domain/1',
		);
	});

	it('retries 429 honoring Retry-After then succeeds', async () => {
		const ctx = fakeCtx([
			{ statusCode: 429, headers: { 'retry-after': '2' }, body: {} },
			{ statusCode: 200, body: { ok: true } },
		]);
		expect(await shortIoRequest.call(ctx, { method: 'GET', path: '/api/domains' })).toEqual({
			ok: true,
		});
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('gives up after MAX_ATTEMPTS 429s with a rate-limit error', async () => {
		const ctx = fakeCtx(
			Array.from({ length: MAX_ATTEMPTS }, () => ({ statusCode: 429, body: { error: 'Too many' } })),
		);
		await expect(shortIoRequest.call(ctx, { method: 'GET', path: '/x' })).rejects.toThrow(
			/rate limit/i,
		);
		expect(ctx.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(MAX_ATTEMPTS);
	});

	it('maps 401 to API-key hint', async () => {
		const ctx = fakeCtx([{ statusCode: 401, body: { error: 'Unauthorized' } }]);
		const err = await shortIoRequest.call(ctx, { method: 'GET', path: '/x' }).catch((e) => e);
		expect(err).toBeInstanceOf(NodeApiError);
		expect(err.description).toMatch(/API key and its domain permissions/);
	});

	it('maps 404 naming the resource', async () => {
		const ctx = fakeCtx([{ statusCode: 404, body: { error: 'Link not found' } }]);
		await expect(
			shortIoRequest.call(ctx, { method: 'GET', path: '/links/lnk_a', resource: 'link' }),
		).rejects.toThrow(/link was not found/i);
	});

	it('maps 409 to path-conflict explanation', async () => {
		const ctx = fakeCtx([{ statusCode: 409, body: { message: 'Link already exists' } }]);
		const err = await shortIoRequest
			.call(ctx, { method: 'POST', path: '/links', resource: 'link' })
			.catch((e) => e);
		expect(err.description).toMatch(/path is already used/i);
	});

	it('reads message from {message} and {error} shapes', async () => {
		const ctx = fakeCtx([
			{ statusCode: 400, body: { message: 'bad field', code: 'x', statusCode: 400, success: false } },
		]);
		await expect(shortIoRequest.call(ctx, { method: 'POST', path: '/links' })).rejects.toThrow(
			/bad field/,
		);
	});

	it('treats 200 {success:false,error} as failure', async () => {
		const ctx = fakeCtx([{ statusCode: 200, body: { success: false, error: 'nope' } }]);
		await expect(
			shortIoRequest.call(ctx, { method: 'DELETE', path: '/links/lnk_a' }),
		).rejects.toThrow(/nope/);
	});

	it('binary mode decodes a JSON error body from raw bytes', async () => {
		const ctx = fakeCtx([
			{ statusCode: 400, body: Buffer.from('{"error":"Invalid body"}') },
		]);
		await expect(
			shortIoRequest.call(ctx, { method: 'POST', path: '/links/qr/bulk', binary: true }),
		).rejects.toThrow(/Invalid body/);
	});

	it('binary mode returns buffer + content type', async () => {
		const ctx = fakeCtx([
			{ statusCode: 201, headers: { 'content-type': 'application/zip' }, body: Buffer.from('PK') },
		]);
		const out = await shortIoRequest.call(ctx, {
			method: 'POST',
			path: '/links/qr/bulk',
			binary: true,
		});
		expect(out).toEqual({ data: Buffer.from('PK'), contentType: 'application/zip' });
		expect(ctx.helpers.httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			encoding: 'arraybuffer',
			json: false,
		});
	});
});

describe('retryDelayMs', () => {
	it('uses Retry-After seconds capped at 30s', () => {
		expect(retryDelayMs(1, '5')).toBe(5000);
		expect(retryDelayMs(1, '999')).toBe(30000);
	});

	it('exponential 1s,2s,4s without header', () => {
		expect(retryDelayMs(1, undefined)).toBe(1000);
		expect(retryDelayMs(2, undefined)).toBe(2000);
		expect(retryDelayMs(3, undefined)).toBe(4000);
	});
});
