import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import {
	buildLinkBody,
	compact,
	LINK_DATE_FIELDS,
	normalizeTags,
	requireOriginalUrl,
	toInstant,
	toIsoDate,
	unwrapOrSuccess,
} from '../shared/fields';
import { fakeCtx } from './helpers';

function fakeThis(): IExecuteFunctions {
	return fakeCtx([]) as unknown as IExecuteFunctions;
}

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

	it('throws when a numeric value looks like epoch seconds (below 1e11)', () => {
		expect(() => toIsoDate(1_700_000_000)).toThrow(
			'Invalid date: 1700000000 looks like epoch seconds; use milliseconds or an ISO date',
		);
	});

	it('throws when a numeric string looks like epoch seconds (below 1e11)', () => {
		expect(() => toIsoDate('1700000000')).toThrow(/looks like epoch seconds/);
	});

	it('accepts a numeric value at or above 1e11 as epoch milliseconds', () => {
		expect(toIsoDate(1e11)).toBe(new Date(1e11).toISOString());
	});

	it('throws on an invalid Date instance', () => {
		expect(() => toIsoDate(new Date('not-a-date'))).toThrow(/Invalid date/);
	});

	it('throws when toISO() returns null', () => {
		const fakeDateTime = { toISO: () => null };
		expect(() => toIsoDate(fakeDateTime)).toThrow(/Invalid date/);
	});
});

describe('toInstant', () => {
	// A zone-less string must be converted to the true instant it names in tz (not toIsoDate's
	// host-process-timezone reading), and an already-zoned string (Z/offset/Date/epoch/Luxon-like)
	// is a real, unambiguous instant already and passes straight through via toIsoDate.

	it('interprets a zone-less string as wall-clock time in tz and returns the true instant', () => {
		expect(toInstant('2026-09-25T00:00:00', 'Asia/Jerusalem')).toBe('2026-09-24T21:00:00.000Z');
	});

	it('is independent of the host process timezone for a zone-less string (the bug this fixes)', () => {
		// toIsoDate alone parses a zone-less string with `new Date(raw)`, which JS interprets in the
		// HOST process's own timezone (TZ env var / system default) — not the workflow's. A
		// process.env.TZ-flipping test was the first approach tried here, but the project's lint
		// config (`@n8n/community-nodes/no-restricted-globals`) bans `process` repo-wide, including
		// tests/ — contrary to the assumption that it's node-code-only. Asserting a single exact
		// instant against one explicit tz isn't a reliable substitute either: this sandbox's own host
		// process happens to default to Asia/Jerusalem (confirmed via
		// `Intl.DateTimeFormat().resolvedOptions().timeZone`), so a test using that same tz would
		// pass identically against the old host-TZ-dependent code purely by coincidence. Instead,
		// this asserts the SAME zone-less input against two different explicit tz values and expects
		// two different true instants — proof the result tracks the passed `tz` and not any single
		// fixed value (host or otherwise), which no coincidental host-TZ match can satisfy.
		expect(toInstant('2026-09-25T12:00:00', 'Asia/Jerusalem')).toBe('2026-09-25T09:00:00.000Z');
		expect(toInstant('2026-09-25T12:00:00', 'America/New_York')).toBe('2026-09-25T16:00:00.000Z');
	});

	it('keeps a Z/offset string unchanged as the real instant it already names', () => {
		expect(toInstant('2026-09-24T21:00:00Z', 'Asia/Jerusalem')).toBe('2026-09-24T21:00:00.000Z');
		expect(toInstant('2026-09-25T00:00:00+03:00', 'Asia/Jerusalem')).toBe(
			'2026-09-24T21:00:00.000Z',
		);
	});

	it('shifts a spring-forward gap time forward by the gap size (not backward)', () => {
		// Regression: an earlier version of this resolution used the post-transition offset here,
		// which shifted the result BACKWARD (02:30 read back as 01:30) instead of forward.
		const instant = toInstant('2026-03-27T02:30:00', 'Asia/Jerusalem');
		expect(instant).toBe('2026-03-27T00:30:00.000Z');
		// Read back in the same zone to confirm it's the documented forward shift, not backward.
		const readback = new Intl.DateTimeFormat('en-US', {
			timeZone: 'Asia/Jerusalem',
			hourCycle: 'h23',
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date(instant!));
		expect(readback).toBe('03:30');
	});

	it('shifts a spring-forward gap time forward for a negative-offset zone too', () => {
		const instant = toInstant('2026-03-08T02:30:00', 'America/New_York');
		expect(instant).toBe('2026-03-08T07:30:00.000Z');
		const readback = new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/New_York',
			hourCycle: 'h23',
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date(instant!));
		expect(readback).toBe('03:30');
	});

	it('resolves to the earlier occurrence for an ambiguous fall-back local time', () => {
		expect(toInstant('2026-10-25T01:30:00', 'Asia/Jerusalem')).toBe('2026-10-24T22:30:00.000Z');
	});

	it('preserves fractional seconds when converting a zone-less string', () => {
		expect(toInstant('2026-09-25T00:00:00.123', 'Asia/Jerusalem')).toBe(
			'2026-09-24T21:00:00.123Z',
		);
	});

	it('converts a Date/epoch/Luxon-like value via toIsoDate, unchanged', () => {
		expect(toInstant(new Date('2026-09-24T21:00:00.000Z'), 'Asia/Jerusalem')).toBe(
			'2026-09-24T21:00:00.000Z',
		);
	});

	it('throws on an unparseable zone-less string', () => {
		expect(() => toInstant('not a date', 'UTC')).toThrow('Invalid date: not a date');
	});

	it('throws on an impossible calendar date (Date.UTC silently normalizes instead of rejecting)', () => {
		expect(() => toInstant('2026-02-30T00:00:00', 'UTC')).toThrow(
			'Invalid date: 2026-02-30T00:00:00',
		);
	});

	it('truncates fractional seconds to at most 3 digits', () => {
		expect(toInstant('2026-09-25T00:00:00.123456', 'UTC')).toBe('2026-09-25T00:00:00.123Z');
	});

	it('returns undefined for empty values', () => {
		expect(toInstant('', 'UTC')).toBeUndefined();
		expect(toInstant(undefined, 'UTC')).toBeUndefined();
		expect(toInstant(null, 'UTC')).toBeUndefined();
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
		}, 'UTC');

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

	it('converts the three date fields via toInstant, leaving an already-zoned value unchanged', () => {
		const body = buildLinkBody(
			{
				expiresAt: 1_768_471_200_000,
				ttl: new Date('2026-06-01T00:00:00.000Z'),
				createdAt: '2026-01-01T00:00:00.000Z',
			},
			'UTC',
		);

		expect(body).toEqual({
			expiresAt: new Date(1_768_471_200_000).toISOString(),
			ttl: '2026-06-01T00:00:00.000Z',
			createdAt: '2026-01-01T00:00:00.000Z',
		});
	});

	it('interprets a zone-less date field as wall-clock time in the passed tz, not a fixed/host one', () => {
		// The exact bug this closes: toIsoDate alone parses a zone-less string with `new Date(raw)`,
		// which is the n8n HOST process's timezone. Two different explicit tz values for the SAME
		// input must give two different instants (this sandbox's host happens to default to
		// Asia/Jerusalem, so asserting only that one tz wouldn't distinguish the fix from the old
		// host-TZ-dependent bug here).
		expect(buildLinkBody({ createdAt: '2026-09-25T12:00:00' }, 'Asia/Jerusalem')).toEqual({
			createdAt: '2026-09-25T09:00:00.000Z',
		});
		expect(buildLinkBody({ createdAt: '2026-09-25T12:00:00' }, 'America/New_York')).toEqual({
			createdAt: '2026-09-25T16:00:00.000Z',
		});
	});

	it('throws for an invalid date field', () => {
		expect(() => buildLinkBody({ expiresAt: 'not-a-date' }, 'UTC')).toThrow(/Invalid date/);
	});

	it('converts a CSV tags string to an array', () => {
		expect(buildLinkBody({ tags: 'a, b,,c' }, 'UTC')).toEqual({ tags: ['a', 'b', 'c'] });
	});

	it('converts an array of tags, trimming each entry', () => {
		expect(buildLinkBody({ tags: ['a', ' b '] }, 'UTC')).toEqual({ tags: ['a', 'b'] });
	});

	it("converts redirectType '302' to the number 302", () => {
		expect(buildLinkBody({ redirectType: '302' }, 'UTC')).toEqual({ redirectType: 302 });
	});

	it('converts a folderId resource locator to its string value', () => {
		expect(
			buildLinkBody({ folderId: { __rl: true, mode: 'list', value: 'fld_1' } }, 'UTC'),
		).toEqual({
			folderId: 'fld_1',
		});
	});

	it('drops an empty folderId resource locator', () => {
		expect(buildLinkBody({ folderId: { __rl: true, mode: 'list', value: '' } }, 'UTC')).toEqual(
			{},
		);
	});

	it('drops empty values: empty string, null and empty array', () => {
		expect(
			buildLinkBody(
				{
					title: '',
					password: null,
					tags: [],
					originalURL: 'https://example.com',
				},
				'UTC',
			),
		).toEqual({ originalURL: 'https://example.com' });
	});

	it('drops an id field if present', () => {
		expect(buildLinkBody({ id: 'lnk_should_not_be_sent', title: 'kept' }, 'UTC')).toEqual({
			title: 'kept',
		});
	});

	it('keeps allowDuplicates:false because false is a meaningful value', () => {
		expect(buildLinkBody({ allowDuplicates: false }, 'UTC')).toEqual({ allowDuplicates: false });
	});

	it('keeps other falsy-but-meaningful values (0, false)', () => {
		expect(buildLinkBody({ clicksLimit: 0, archived: false }, 'UTC')).toEqual({
			clicksLimit: 0,
			archived: false,
		});
	});
});

describe('requireOriginalUrl', () => {
	it('returns the trimmed value when non-empty', () => {
		expect(requireOriginalUrl.call(fakeThis(), '  https://example.com  ', 0)).toBe(
			'https://example.com',
		);
	});

	it('throws NodeOperationError for an empty string', () => {
		expect(() => requireOriginalUrl.call(fakeThis(), '', 0)).toThrow(NodeOperationError);
	});

	it('throws NodeOperationError for a whitespace-only string', () => {
		expect(() => requireOriginalUrl.call(fakeThis(), '   ', 0)).toThrow(NodeOperationError);
	});

	it('throws NodeOperationError for undefined', () => {
		expect(() => requireOriginalUrl.call(fakeThis(), undefined, 0)).toThrow(NodeOperationError);
	});
});

describe('unwrapOrSuccess', () => {
	it('returns the response as-is when it is a non-empty, non-array object', () => {
		expect(unwrapOrSuccess({ id: 'abc', ok: true })).toEqual({ id: 'abc', ok: true });
	});

	it('returns {success: true} for an empty object', () => {
		expect(unwrapOrSuccess({})).toEqual({ success: true });
	});

	it('returns {success: true} for null', () => {
		expect(unwrapOrSuccess(null)).toEqual({ success: true });
	});

	it('returns {success: true} for an array response', () => {
		expect(unwrapOrSuccess([{ id: 'abc' }])).toEqual({ success: true });
	});

	it('returns {success: true} for a non-object response', () => {
		expect(unwrapOrSuccess('unexpected')).toEqual({ success: true });
	});
});
