import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import { DomainCache, parseShortUrl, resolveDomainId, resolveLinkId } from '../shared/locators';
import { fakeCtx } from './helpers';

describe('parseShortUrl', () => {
	it('parses a simple short URL', () => {
		expect(parseShortUrl('https://s.gy/abc')).toEqual({ hostname: 's.gy', path: 'abc' });
	});

	it('lowercases the host and strips a trailing slash', () => {
		expect(parseShortUrl('https://S.GY/abc/')).toEqual({ hostname: 's.gy', path: 'abc' });
	});

	it('strips the query string and hash, keeping a multi-segment path', () => {
		expect(parseShortUrl('http://s.gy/a/b?x=1#y')).toEqual({ hostname: 's.gy', path: 'a/b' });
	});

	it('accepts a URL with no scheme', () => {
		expect(parseShortUrl('s.gy/abc')).toEqual({ hostname: 's.gy', path: 'abc' });
	});

	it('throws when the path is missing', () => {
		expect(() => parseShortUrl('https://s.gy/')).toThrow();
	});

	it('decodes a unicode path instead of leaving it percent-encoded', () => {
		expect(parseShortUrl('https://s.gy/Привет')).toEqual({ hostname: 's.gy', path: 'Привет' });
	});

	it('decodes an already-encoded path', () => {
		expect(parseShortUrl('https://s.gy/a%20b')).toEqual({ hostname: 's.gy', path: 'a b' });
	});

	it('punycode-encodes a unicode host', () => {
		expect(parseShortUrl('https://Bücher.de/x')).toEqual({ hostname: 'xn--bcher-kva.de', path: 'x' });
	});
});

describe('resolveDomainId', () => {
	it('accepts a resourceLocator value', () => {
		expect(resolveDomainId({ __rl: true, mode: 'list', value: '123' })).toBe(123);
	});

	it('accepts a plain numeric string', () => {
		expect(resolveDomainId('45')).toBe(45);
	});

	it('throws on a non-numeric value', () => {
		expect(() => resolveDomainId('abc')).toThrow();
	});

	it('throws on zero', () => {
		expect(() => resolveDomainId('0')).toThrow();
	});
});

describe('resolveLinkId', () => {
	it('accepts an "lnk_" id without an HTTP call', async () => {
		const ctx = fakeCtx([]);
		const id = await resolveLinkId.call(
			ctx as unknown as IExecuteFunctions,
			{ __rl: true, mode: 'id', value: 'lnk_abc_d' },
			0,
		);
		expect(id).toBe('lnk_abc_d');
		expect(ctx.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('accepts a "link_" id without an HTTP call', async () => {
		const ctx = fakeCtx([]);
		const id = await resolveLinkId.call(
			ctx as unknown as IExecuteFunctions,
			{ __rl: true, mode: 'id', value: 'link_1hwf_034U' },
			0,
		);
		expect(id).toBe('link_1hwf_034U');
		expect(ctx.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('throws a NodeOperationError for an invalid id', async () => {
		const ctx = fakeCtx([]);
		await expect(
			resolveLinkId.call(ctx as unknown as IExecuteFunctions, { __rl: true, mode: 'id', value: 'foo' }, 0),
		).rejects.toThrow(NodeOperationError);
	});

	it('resolves a short URL via GET /links/expand', async () => {
		const ctx = fakeCtx([{ statusCode: 200, body: { idString: 'lnk_x_y' } }]);
		const id = await resolveLinkId.call(
			ctx as unknown as IExecuteFunctions,
			{ __rl: true, mode: 'url', value: 'https://s.gy/abc' },
			0,
		);
		expect(id).toBe('lnk_x_y');
		const call = (ctx.helpers.httpRequestWithAuthentication as unknown as { mock: { calls: unknown[][] } })
			.mock.calls[0];
		expect(call[1]).toMatchObject({ qs: { domain: 's.gy', path: 'abc' } });
	});

	it('rejects an unexpected idString shape returned by GET /links/expand before it can be used in a path', async () => {
		// Defense in depth: idString is later interpolated unescaped into a request path (e.g.
		// `/links/${id}`), so an unexpected value from the API response must never reach a caller.
		const ctx = fakeCtx([{ statusCode: 200, body: { idString: '../etc/passwd' } }]);
		await expect(
			resolveLinkId.call(
				ctx as unknown as IExecuteFunctions,
				{ __rl: true, mode: 'url', value: 'https://s.gy/abc' },
				0,
			),
		).rejects.toThrow(NodeOperationError);
	});
});

describe('DomainCache', () => {
	it('makes one HTTP call for two concurrent gets of the same id', async () => {
		const ctx = fakeCtx([{ statusCode: 200, body: { id: 1, hostname: 's.gy' } }]);
		const cache = new DomainCache();

		const [a, b] = await Promise.all([cache.get(ctx, 1), cache.get(ctx, 1)]);

		expect(a).toEqual({ id: 1, hostname: 's.gy' });
		expect(b).toEqual({ id: 1, hostname: 's.gy' });
		expect(ctx.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('evicts a rejected lookup so a later get retries instead of replaying the failure', async () => {
		const ctx = fakeCtx([
			{ statusCode: 500, body: { error: 'boom' } },
			{ statusCode: 200, body: { id: 1, hostname: 's.gy' } },
		]);
		const cache = new DomainCache();

		await expect(cache.get(ctx, 1)).rejects.toThrow();
		const domain = await cache.get(ctx, 1);

		expect(domain).toEqual({ id: 1, hostname: 's.gy' });
		expect(ctx.helpers.httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});
});
