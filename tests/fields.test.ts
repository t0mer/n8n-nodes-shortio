import { describe, expect, it } from 'vitest';

import { buildLinkBody, compact, LINK_DATE_FIELDS, normalizeTags, toIsoDate } from '../shared/fields';

describe('toIsoDate', () => {
	it('passes an ISO string through as an ISO string', () => {
		expect(toIsoDate('2026-01-15T10:00:00.000Z')).toBe('2026-01-15T10:00:00.000Z');
	});

	it('converts an epoch-ms number to an ISO string', () => {
		expect(toIsoDate(1_768_471_200_000)).toBe(new Date(1_768_471_200_000).toISOString());
	});

	it('converts an epoch-ms numeric string to an ISO string', () => {
		expect(toIsoDate('1768471200000')).toBe(new Date(1_768_471_200_000).toISOString());
	});

	it('converts a Date instance to an ISO string', () => {
		const date = new Date('2026-03-01T00:00:00.000Z');
		expect(toIsoDate(date)).toBe(date.toISOString());
	});

	it('converts an n8n-style DateTime (object with toISO()) to an ISO string', () => {
		const fakeDateTime = { toISO: () => '2026-05-01T00:00:00.000Z' };
		expect(toIsoDate(fakeDateTime)).toBe('2026-05-01T00:00:00.000Z');
	});

	it('returns undefined for an empty string', () => {
		expect(toIsoDate('')).toBeUndefined();
	});

	it('returns undefined for null', () => {
		expect(toIsoDate(null)).toBeUndefined();
	});

	it('returns undefined for undefined', () => {
		expect(toIsoDate(undefined)).toBeUndefined();
	});

	it('throws on an invalid date string', () => {
		expect(() => toIsoDate('not-a-date')).toThrow('Invalid date: not-a-date');
	});

	it('throws on an invalid Date instance', () => {
		expect(() => toIsoDate(new Date('not-a-date'))).toThrow(/Invalid date/);
	});

	it('throws when toISO() returns null', () => {
		const fakeDateTime = { toISO: () => null };
		expect(() => toIsoDate(fakeDateTime)).toThrow(/Invalid date/);
	});
});

describe('normalizeTags', () => {
	it('splits a comma-separated string and drops empty segments', () => {
		expect(normalizeTags('a, b,,c')).toEqual(['a', 'b', 'c']);
	});

	it('trims each element of an array', () => {
		expect(normalizeTags(['a', ' b '])).toEqual(['a', 'b']);
	});

	it('returns undefined for an empty string', () => {
		expect(normalizeTags('')).toBeUndefined();
	});

	it('returns undefined for an empty array', () => {
		expect(normalizeTags([])).toBeUndefined();
	});

	it('returns undefined for undefined', () => {
		expect(normalizeTags(undefined)).toBeUndefined();
	});
});

describe('compact', () => {
	it('drops undefined, null, empty string and empty array values', () => {
		expect(
			compact({
				a: undefined,
				b: null,
				c: '',
				d: [],
				e: 'kept',
				f: 0,
				g: false,
			}),
		).toEqual({ e: 'kept', f: 0, g: false });
	});

	it('drops an empty resource locator', () => {
		expect(
			compact({
				folderId: { __rl: true, mode: 'list', value: '' },
				link: { __rl: true, mode: 'id', value: 'lnk_abc_d' },
			}),
		).toEqual({ link: { __rl: true, mode: 'id', value: 'lnk_abc_d' } });
	});
});

describe('LINK_DATE_FIELDS', () => {
	it('lists exactly the three link date fields', () => {
		expect(LINK_DATE_FIELDS).toEqual(['expiresAt', 'ttl', 'createdAt']);
	});
});

describe('buildLinkBody', () => {
	it('passes every Create-collection field through under its API name', () => {
		const body = buildLinkBody({
			integrationAdroll: 'adroll-1',
			allowDuplicates: true,
			androidURL: 'https://android.example',
			archived: true,
			clicksLimit: 5,
			cloaking: true,
			createdAt: '2026-01-01T00:00:00.000Z',
			expiredURL: 'https://expired.example',
			expiresAt: '2026-06-01T00:00:00.000Z',
			integrationFB: 'fb-1',
			integrationGA: 'ga-1',
			integrationGTM: 'gtm-1',
			iphoneURL: 'https://iphone.example',
			password: 'secret',
			passwordContact: true,
			path: 'my-path',
			redirectType: '302',
			skipQS: true,
			splitPercent: 50,
			splitURL: 'https://split.example',
			tags: 'a,b',
			title: 'My title',
			ttl: '2026-12-01T00:00:00.000Z',
			utmCampaign: 'camp',
			utmContent: 'content',
			utmMedium: 'medium',
			utmSource: 'source',
			utmTerm: 'term',
		});

		expect(body).toEqual({
			integrationAdroll: 'adroll-1',
			allowDuplicates: true,
			androidURL: 'https://android.example',
			archived: true,
			clicksLimit: 5,
			cloaking: true,
			createdAt: '2026-01-01T00:00:00.000Z',
			expiredURL: 'https://expired.example',
			expiresAt: '2026-06-01T00:00:00.000Z',
			integrationFB: 'fb-1',
			integrationGA: 'ga-1',
			integrationGTM: 'gtm-1',
			iphoneURL: 'https://iphone.example',
			password: 'secret',
			passwordContact: true,
			path: 'my-path',
			redirectType: 302,
			skipQS: true,
			splitPercent: 50,
			splitURL: 'https://split.example',
			tags: ['a', 'b'],
			title: 'My title',
			ttl: '2026-12-01T00:00:00.000Z',
			utmCampaign: 'camp',
			utmContent: 'content',
			utmMedium: 'medium',
			utmSource: 'source',
			utmTerm: 'term',
		});
	});

	it('converts the three date fields via toIsoDate', () => {
		const body = buildLinkBody({
			expiresAt: 1_768_471_200_000,
			ttl: new Date('2026-06-01T00:00:00.000Z'),
			createdAt: '2026-01-01T00:00:00.000Z',
		});

		expect(body).toEqual({
			expiresAt: new Date(1_768_471_200_000).toISOString(),
			ttl: '2026-06-01T00:00:00.000Z',
			createdAt: '2026-01-01T00:00:00.000Z',
		});
	});

	it('throws for an invalid date field', () => {
		expect(() => buildLinkBody({ expiresAt: 'not-a-date' })).toThrow(/Invalid date/);
	});

	it('converts a CSV tags string to an array', () => {
		expect(buildLinkBody({ tags: 'a, b,,c' })).toEqual({ tags: ['a', 'b', 'c'] });
	});

	it('converts an array of tags, trimming each entry', () => {
		expect(buildLinkBody({ tags: ['a', ' b '] })).toEqual({ tags: ['a', 'b'] });
	});

	it("converts redirectType '302' to the number 302", () => {
		expect(buildLinkBody({ redirectType: '302' })).toEqual({ redirectType: 302 });
	});

	it('converts a folderId resource locator to its string value', () => {
		expect(buildLinkBody({ folderId: { __rl: true, mode: 'list', value: 'fld_1' } })).toEqual({
			folderId: 'fld_1',
		});
	});

	it('drops an empty folderId resource locator', () => {
		expect(buildLinkBody({ folderId: { __rl: true, mode: 'list', value: '' } })).toEqual({});
	});

	it('drops empty values: empty string, null and empty array', () => {
		expect(
			buildLinkBody({
				title: '',
				password: null,
				tags: [],
				originalURL: 'https://example.com',
			}),
		).toEqual({ originalURL: 'https://example.com' });
	});

	it('drops an id field if present', () => {
		expect(buildLinkBody({ id: 'lnk_should_not_be_sent', title: 'kept' })).toEqual({
			title: 'kept',
		});
	});

	it('keeps allowDuplicates:false because false is a meaningful value', () => {
		expect(buildLinkBody({ allowDuplicates: false })).toEqual({ allowDuplicates: false });
	});

	it('keeps other falsy-but-meaningful values (0, false)', () => {
		expect(buildLinkBody({ clicksLimit: 0, archived: false })).toEqual({
			clicksLimit: 0,
			archived: false,
		});
	});
});
