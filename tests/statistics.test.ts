import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import {
	buildPeriod,
	buildStatsFilters,
	buildTimezone,
	isAfter,
	toStatsWallClock,
} from '../nodes/ShortIo/descriptions/statistics';
import { statisticsDescription } from '../nodes/ShortIo/resources/statistics/description';
import { statisticsHandlers } from '../nodes/ShortIo/resources/statistics/execute';
import type { ItemHandler } from '../shared/types';
import { fakeCtx, type Resp } from './helpers';

const DOMAIN = { __rl: true, mode: 'id', value: '123' };

function fakeExec(params: Record<string, unknown>, responses: Resp[] = []): IExecuteFunctions {
	return fakeCtx(responses, {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getTimezone: () => 'Europe/Berlin',
		continueOnFail: () => false,
	}) as unknown as IExecuteFunctions;
}

type Opts = { method: string; url: string; qs?: Record<string, unknown>; body?: unknown };

function calls(exec: IExecuteFunctions): Opts[] {
	return (
		exec.helpers.httpRequestWithAuthentication as unknown as { mock: { calls: unknown[][] } }
	).mock.calls.map((c) => c[1] as Opts);
}

function run(operation: string, exec: IExecuteFunctions, i = 0) {
	return (statisticsHandlers[operation].run as ItemHandler).call(exec, i, {
		domains: undefined as never,
	});
}

describe('removed operations (404 Route not found on the live API)', () => {
	it('no longer registers Clear Domain Statistics or Get Domain Top Values by Interval', () => {
		expect(statisticsHandlers).not.toHaveProperty('clearDomainStatistics');
		expect(statisticsHandlers).not.toHaveProperty('getDomainTopValuesByInterval');
	});

	it('drops both operations from the description options list', () => {
		const operationField = statisticsDescription.find(
			(f) => 'name' in f && f.name === 'operation',
		) as { options: Array<{ value: string }> };
		const values = operationField.options.map((o) => o.value);
		expect(values).not.toContain('clearDomainStatistics');
		expect(values).not.toContain('getDomainTopValuesByInterval');
	});
});

describe('toStatsWallClock', () => {
	// Live API quirk: whenever `tz` is present, the statistics API reads startDate/endDate/dt's
	// clock digits as wall-clock time in `tz` and discards any offset the string itself carries.
	// So a zone-less string is already the intended reading (passed through with a literal `Z`),
	// while an offset/instant value has to be converted TO its wall-clock reading in `tz` first.

	it('passes a zone-less string through unchanged, with a literal Z appended', () => {
		expect(toStatsWallClock('2026-09-25T23:59:00', 'Asia/Jerusalem')).toBe(
			'2026-09-25T23:59:00Z',
		);
	});

	it('trims a zone-less string before validating it', () => {
		expect(toStatsWallClock(' 2026-09-25T23:59:00 ', 'UTC')).toBe('2026-09-25T23:59:00Z');
	});

	it('keeps fractional seconds in a zone-less string', () => {
		expect(toStatsWallClock('2026-09-25T23:59:00.123', 'UTC')).toBe('2026-09-25T23:59:00.123Z');
	});

	it('converts an offset string to its wall-clock reading in tz (the double-shift fix)', () => {
		// The exact live-evidence case: sending this +03:00 value straight through (the pre-fix
		// behavior) makes the API shift it by +03:00 a second time and silently return 0 clicks.
		expect(toStatsWallClock('2026-09-25T00:00:00+03:00', 'Asia/Jerusalem')).toBe(
			'2026-09-25T00:00:00Z',
		);
	});

	it('converts a Z instant to its wall-clock reading in Asia/Jerusalem (+03:00 in September)', () => {
		expect(toStatsWallClock('2026-09-24T21:00:00Z', 'Asia/Jerusalem')).toBe(
			'2026-09-25T00:00:00Z',
		);
	});

	it('converts the same instant to its wall-clock reading in America/New_York (-04:00 in September)', () => {
		expect(toStatsWallClock('2026-09-24T21:00:00Z', 'America/New_York')).toBe(
			'2026-09-24T17:00:00Z',
		);
	});

	it('converts a DST-edge instant to its wall-clock reading correctly (no ambiguity in this direction)', () => {
		// Instant->local is always unambiguous via Intl, unlike the reverse (local->instant), which
		// is why this direction needs no gap/ambiguous-hour resolution at all.
		expect(toStatsWallClock('2026-03-08T06:30:00.123Z', 'America/New_York')).toBe(
			'2026-03-08T01:30:00.123Z',
		);
	});

	it("uses a Luxon-like value's own .toISO() as the instant to convert", () => {
		const fakeDateTime = { toISO: () => '2026-09-24T21:00:00.000Z' };
		expect(toStatsWallClock(fakeDateTime, 'Asia/Jerusalem')).toBe('2026-09-25T00:00:00Z');
	});

	it('converts a Date/epoch value the same way', () => {
		expect(toStatsWallClock(new Date('2026-09-24T21:00:00.000Z'), 'Asia/Jerusalem')).toBe(
			'2026-09-25T00:00:00Z',
		);
	});

	it('throws on an unparseable zone-less string', () => {
		expect(() => toStatsWallClock('not a date', 'UTC')).toThrow('Invalid date: not a date');
	});

	it('throws on an invalid tz', () => {
		expect(() => toStatsWallClock('2026-09-25T00:00:00Z', 'Not/AZone')).toThrow();
	});

	it('throws on an invalid tz even with a zone-less input (regression: the zone-less branch used to skip tz validation entirely)', () => {
		expect(() => toStatsWallClock('2026-09-25T00:00:00', 'Not/AZone')).toThrow(
			'Invalid timezone: Not/AZone',
		);
	});

	it('throws on an impossible calendar date (Date.UTC silently normalizes instead of rejecting)', () => {
		expect(() => toStatsWallClock('2026-02-30T00:00:00', 'UTC')).toThrow(
			'Invalid date: 2026-02-30T00:00:00',
		);
	});

	it('truncates fractional seconds to at most 3 digits', () => {
		expect(toStatsWallClock('2026-09-25T23:59:00.123456', 'UTC')).toBe(
			'2026-09-25T23:59:00.123Z',
		);
	});

	it('returns undefined for empty values', () => {
		expect(toStatsWallClock('', 'UTC')).toBeUndefined();
		expect(toStatsWallClock(undefined, 'UTC')).toBeUndefined();
		expect(toStatsWallClock(null, 'UTC')).toBeUndefined();
	});

	describe('non-naive strings delegate to toIsoDate unchanged (regression: an earlier version routed anything without a trailing Z/offset into the naive-parse path, breaking every non-ISO format toIsoDate used to accept)', () => {
		it('accepts an epoch-ms numeric string, converting the resulting instant to its wall-clock reading in tz', () => {
			expect(toStatsWallClock('1758801600000', 'UTC')).toBe('2025-09-25T12:00:00Z');
		});

		it('accepts an RFC 2822 string the same way', () => {
			expect(toStatsWallClock('Thu, 25 Sep 2026 12:00:00 GMT', 'UTC')).toBe(
				'2026-09-25T12:00:00Z',
			);
		});

		it("routes an hour-only offset string ('+03', missing minutes — not the naive shape) to toIsoDate, which rejects it the same way it always did", () => {
			expect(() => toStatsWallClock('2026-09-25T12:00:00+03', 'UTC')).toThrow(/Invalid date/);
		});

		it('still throws for a seconds-scale epoch numeric string, exactly as toIsoDate does', () => {
			expect(() => toStatsWallClock('1700000000', 'UTC')).toThrow(/looks like epoch seconds/);
		});
	});
});

describe('isAfter', () => {
	it('is false when a shorter fractional-second suffix would sort lexically after a longer one', () => {
		// The exact live-evidence false positive: as strings, '...T10:00:00Z' > '...T10:00:00.5Z' is
		// true (Z sorts after '.'), even though .5s is 500ms LATER. isAfter must compare instants.
		expect(isAfter('2026-09-01T10:00:00Z', '2026-09-01T10:00:00.5Z')).toBe(false);
	});

	it('is true when a is a strictly later instant than b', () => {
		expect(isAfter('2026-09-02T00:00:00Z', '2026-09-01T00:00:00Z')).toBe(true);
	});

	it('is false for equal instants', () => {
		expect(isAfter('2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')).toBe(false);
	});
});

describe('buildPeriod', () => {
	it('returns only the period for a preset', () => {
		const exec = fakeExec({ period: 'last7', startDate: '2026-01-01' });
		expect(buildPeriod(exec, 0, 'UTC')).toEqual({ period: 'last7' });
	});

	it('defaults to last30', () => {
		expect(buildPeriod(fakeExec({}), 0, 'UTC')).toEqual({ period: 'last30' });
	});

	it('converts a Z-suffixed start/end instant to its wall-clock reading in tz, marked Z', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-01T00:00:00.000Z',
			endDate: '2026-09-15T23:59:59.000Z',
		});
		expect(buildPeriod(exec, 0, 'UTC')).toEqual({
			period: 'custom',
			startDate: '2026-09-01T00:00:00Z',
			endDate: '2026-09-15T23:59:59Z',
		});
	});

	it('accepts equal start and end dates', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-01', endDate: '2026-09-01' });
		expect(buildPeriod(exec, 0, 'UTC').startDate).toBe('2026-09-01T00:00:00Z');
	});

	it('passes a zone-less start/end date-time through unchanged (already wall-clock in tz), regardless of tz', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-25T23:59:00',
			endDate: '2026-09-26T00:00:00',
		});
		expect(buildPeriod(exec, 0, 'Asia/Jerusalem')).toEqual({
			period: 'custom',
			startDate: '2026-09-25T23:59:00Z',
			endDate: '2026-09-26T00:00:00Z',
		});
	});

	it('rejects a start date after the end date', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-15T00:00:00.000Z',
			endDate: '2026-09-01T00:00:00.000Z',
		});
		expect(() => buildPeriod(exec, 0, 'UTC')).toThrow(/must not be after/);
	});

	it('does not false-positive when end has a fractional second and start does not (regression: lexical > on the output strings)', () => {
		// Pre-fix, comparing the output strings lexically flagged this as start > end, because 'Z'
		// sorts after '.' even though the fractional value is later.
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-01T10:00:00',
			endDate: '2026-09-01T10:00:00.5',
		});
		expect(buildPeriod(exec, 0, 'UTC')).toEqual({
			period: 'custom',
			startDate: '2026-09-01T10:00:00Z',
			endDate: '2026-09-01T10:00:00.5Z',
		});
	});

	it('rejects an impossible calendar date before any HTTP call', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-02-30T00:00:00',
			endDate: '2026-09-01T00:00:00',
		});
		expect(() => buildPeriod(exec, 0, 'UTC')).toThrow('Invalid date: 2026-02-30T00:00:00');
	});

	it('rejects custom without both dates', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-15' });
		expect(() => buildPeriod(exec, 0, 'UTC')).toThrow(NodeOperationError);
	});

	it('rejects an invalid tz', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-01T00:00:00Z',
			endDate: '2026-09-02T00:00:00Z',
		});
		expect(() => buildPeriod(exec, 0, 'Not/AZone')).toThrow('Invalid timezone: Not/AZone');
	});
});

describe('buildTimezone', () => {
	it('uses the given IANA name, trimmed', () => {
		expect(buildTimezone(fakeExec({ timezone: ' Asia/Jerusalem ' }), 0)).toBe('Asia/Jerusalem');
	});

	it('falls back to the workflow timezone when empty', () => {
		expect(buildTimezone(fakeExec({ timezone: '' }), 0)).toBe('Europe/Berlin');
	});

	it('throws on an invalid tz', () => {
		expect(() => buildTimezone(fakeExec({ timezone: 'Not/AZone' }), 0)).toThrow(
			'Invalid timezone: Not/AZone',
		);
	});

	it('throws when the fallback workflow timezone itself is invalid', () => {
		const exec = fakeCtx([], {
			getNodeParameter: () => '',
			getTimezone: () => 'Not/AZone',
		}) as unknown as IExecuteFunctions;
		expect(() => buildTimezone(exec, 0)).toThrow('Invalid timezone: Not/AZone');
	});
});

describe('buildStatsFilters', () => {
	it('splits and trims CSV columns, converts statuses and builds the date range', () => {
		const filters = buildStatsFilters(
			{
				include: {
					columns: {
						browsers: ' Chrome, Firefox ,,Chrome',
						statuses: '301, 404',
						countries: ['us', 'IL'],
						dtStart: '2026-09-01T00:00:00.000Z',
						dtEnd: '2026-09-02T00:00:00.000Z',
						human: true,
					},
				},
				exclude: { columns: { refhosts: 'spam.example' } },
			},
			'UTC',
		);
		expect(filters).toEqual({
			include: {
				browsers: ['Chrome', 'Firefox'],
				statuses: [301, 404],
				countries: ['US', 'IL'],
				dt: ['2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'],
				human: true,
			},
			exclude: { refhosts: ['spam.example'] },
		});
	});

	it('drops empty filter sets', () => {
		expect(buildStatsFilters({}, 'UTC')).toEqual({});
		expect(buildStatsFilters(undefined, 'UTC')).toEqual({});
		expect(
			buildStatsFilters(
				{ include: { columns: { browsers: ' , ', countries: [] } }, exclude: {} },
				'UTC',
			),
		).toEqual({});
	});

	it('keeps human=false as a meaningful value', () => {
		expect(buildStatsFilters({ exclude: { columns: { human: false } } }, 'UTC')).toEqual({
			exclude: { human: false },
		});
	});

	it('rejects a non-numeric status', () => {
		expect(() =>
			buildStatsFilters({ include: { columns: { statuses: '301, abc' } } }, 'UTC'),
		).toThrow(/not a valid HTTP status code/);
	});

	it('rejects an invalid country code', () => {
		expect(() =>
			buildStatsFilters({ include: { columns: { countries: ['USA'] } } }, 'UTC'),
		).toThrow(/not a valid country code/);
	});

	it('rejects a half-set date range', () => {
		expect(() =>
			buildStatsFilters({ include: { columns: { dtStart: '2026-09-01' } } }, 'UTC'),
		).toThrow(/both a start and an end/);
	});

	it('does not false-positive when dtEnd has a fractional second and dtStart does not (regression: lexical > on the output strings)', () => {
		const filters = buildStatsFilters(
			{
				include: {
					columns: { dtStart: '2026-09-01T10:00:00', dtEnd: '2026-09-01T10:00:00.5' },
				},
			},
			'UTC',
		);
		expect(filters).toEqual({
			include: { dt: ['2026-09-01T10:00:00Z', '2026-09-01T10:00:00.5Z'] },
		});
	});

	it('rejects an impossible calendar date in the date range', () => {
		expect(() =>
			buildStatsFilters(
				{ include: { columns: { dtStart: '2026-02-30T00:00:00', dtEnd: '2026-09-01T00:00:00' } } },
				'UTC',
			),
		).toThrow('Invalid date: 2026-02-30T00:00:00');
	});
});

describe('get domain statistics', () => {
	it('uses GET with query params on the statistics host when no filters are set', async () => {
		const exec = fakeExec({ domain: DOMAIN, period: 'today', timezone: 'UTC' }, [
			{ statusCode: 200, body: { clicks: 5 } },
		]);

		const items = await run('getDomainStatistics', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('GET');
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123');
		expect(opts.qs).toEqual({ period: 'today', tz: 'UTC' });
		expect(opts.body).toBeUndefined();
		expect(items).toEqual([{ json: { clicks: 5 } }]);
	});

	it('uses POST with filters and period fields in the body when filters are set', async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				period: 'custom',
				startDate: '2026-09-01',
				endDate: '2026-09-02',
				filters: { include: { columns: { paths: 'a,b' } } },
				options: { clicksChartInterval: 'hour' },
			},
			[{ statusCode: 200, body: { clicks: 1 } }],
		);

		await run('getDomainStatistics', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.qs).toBeUndefined();
		expect(opts.body).toEqual({
			period: 'custom',
			startDate: '2026-09-01T00:00:00Z',
			endDate: '2026-09-02T00:00:00Z',
			tz: 'Europe/Berlin',
			clicksChartInterval: 'hour',
			include: { paths: ['a', 'b'] },
		});
	});

	it('uses POST when Skip Tops is set, since GET does not support it', async () => {
		const exec = fakeExec({ domain: DOMAIN, options: { skipTops: true } }, [
			{ statusCode: 200, body: { clicks: 1 } },
		]);

		await run('getDomainStatistics', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.body).toMatchObject({ skipTops: true });
	});

	it('rejects a path-traversal domain value before any HTTP call', async () => {
		const exec = fakeExec({ domain: { __rl: true, mode: 'id', value: '../links' } });
		await expect(run('getDomainStatistics', exec)).rejects.toThrow();
		expect(calls(exec)).toHaveLength(0);
	});
});

describe('by-interval and top operations', () => {
	it('posts by_interval with clicksChartInterval', async () => {
		const exec = fakeExec({ domain: DOMAIN, clicksChartInterval: 'week' }, [
			{ statusCode: 200, body: { clickStatistics: [] } },
		]);

		await run('getDomainStatisticsByInterval', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123/by_interval');
		expect(opts.body).toEqual({ period: 'last30', tz: 'Europe/Berlin', clicksChartInterval: 'week' });
	});

	it('posts top with column, limit and prefix, and outputs one item per value', async () => {
		const exec = fakeExec({ domain: DOMAIN, column: 'country', limit: 5, prefix: 'U' }, [
			{
				statusCode: 200,
				body: [
					{ score: 3, column: 'US', displayName: 'United States' },
					{ score: 1, column: 'UA', displayName: 'Ukraine' },
				],
			},
		]);

		const items = await run('getDomainTopValues', exec);

		const [opts] = calls(exec);
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123/top');
		expect(opts.body).toEqual({
			column: 'country',
			limit: 5,
			prefix: 'U',
			period: 'last30',
			tz: 'Europe/Berlin',
		});
		expect(items).toHaveLength(2);
	});
});

describe('get link clicks', () => {
	it('sends GET with ids CSV and optional dates in the query, as true instants via this.getTimezone()', async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				identifyBy: 'id',
				linkIds: ' lnk_a1, link_b2 ',
				dateRange: { startDate: '2026-09-01', endDate: '2026-09-10' },
			},
			[{ statusCode: 200, body: { lnk_a1: 4, link_b2: 0 } }],
		);

		const items = await run('getLinkClicks', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('GET');
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123/link_clicks');
		// fakeExec's getTimezone() is 'Europe/Berlin', +02:00 (CEST) in September: link_clicks sends
		// no `tz` param, so a zone-less date is converted to the true UTC instant it names.
		expect(opts.qs).toEqual({
			ids: 'lnk_a1,link_b2',
			startDate: '2026-08-31T22:00:00.000Z',
			endDate: '2026-09-09T22:00:00.000Z',
		});
		expect(items).toEqual([{ json: { lnk_a1: 4, link_b2: 0 } }]);
	});

	it('rejects an invalid link id before any HTTP call', async () => {
		const exec = fakeExec({ domain: DOMAIN, identifyBy: 'id', linkIds: 'lnk_a1,../x' });
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/not a valid link ID/);
		expect(calls(exec)).toHaveLength(0);
	});

	it('names the link, not the domain, on a 404', async () => {
		const exec = fakeExec(
			{ domain: DOMAIN, identifyBy: 'id', linkIds: 'lnk_a1' },
			[{ statusCode: 404, body: { error: 'Not found' } }],
		);
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/link was not found/i);
	});

	it('normalizes a full short URL and a leading-slash path to bare paths, with required Created At', async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				identifyBy: 'path',
				pathsDates: {
					link: [
						{ path: 'https://s.example/abc', createdAt: '2026-08-17T16:16:06.000Z' },
						{ path: ' /def ', createdAt: '2026-08-18T00:00:00.000Z' },
						{ path: 'ghi', createdAt: '2026-08-19T00:00:00.000Z' },
					],
				},
				dateRange: { startDate: '2026-09-01' },
			},
			[{ statusCode: 200, body: { abc: 22 } }],
		);

		const items = await run('getLinkClicks', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.qs).toEqual({ startDate: '2026-08-31T22:00:00.000Z' });
		expect(opts.body).toEqual({
			pathsDates: [
				{ path: 'abc', createdAt: '2026-08-17T16:16:06.000Z' },
				{ path: 'def', createdAt: '2026-08-18T00:00:00.000Z' },
				{ path: 'ghi', createdAt: '2026-08-19T00:00:00.000Z' },
			],
		});
		expect(items).toEqual([{ json: { abc: 22 } }]);
	});

	it('normalizes a scheme-less host/path, and strips a query string and trailing slash from a bare path', async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				identifyBy: 'path',
				pathsDates: {
					link: [
						{ path: '2l0h.short.gy/abc', createdAt: '2026-08-17T16:16:06.000Z' },
						{ path: 'def/?utm_source=x#frag', createdAt: '2026-08-18T00:00:00.000Z' },
						{ path: 'gh%20i/', createdAt: '2026-08-19T00:00:00.000Z' },
					],
				},
			},
			[{ statusCode: 200, body: {} }],
		);

		await run('getLinkClicks', exec);

		const [opts] = calls(exec);
		expect(opts.body).toEqual({
			pathsDates: [
				{ path: 'abc', createdAt: '2026-08-17T16:16:06.000Z' },
				{ path: 'def', createdAt: '2026-08-18T00:00:00.000Z' },
				{ path: 'gh i', createdAt: '2026-08-19T00:00:00.000Z' },
			],
		});
	});

	it("converts a zone-less Created At to a true instant via this.getTimezone()", async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				identifyBy: 'path',
				pathsDates: { link: [{ path: 'abc', createdAt: '2026-08-17T16:16:06' }] },
			},
			[{ statusCode: 200, body: {} }],
		);

		await run('getLinkClicks', exec);

		const [opts] = calls(exec);
		expect(opts.body).toEqual({
			pathsDates: [{ path: 'abc', createdAt: '2026-08-17T14:16:06.000Z' }],
		});
	});

	it('rejects a path entry missing Created At before any HTTP call', async () => {
		const exec = fakeExec({
			domain: DOMAIN,
			identifyBy: 'path',
			pathsDates: { link: [{ path: 'abc' }] },
		});
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/needs a Created At/);
		expect(calls(exec)).toHaveLength(0);
	});

	it('rejects an empty path list', async () => {
		const exec = fakeExec({ domain: DOMAIN, identifyBy: 'path', pathsDates: {} });
		await expect(run('getLinkClicks', exec)).rejects.toThrow(NodeOperationError);
		expect(calls(exec)).toHaveLength(0);
	});

	it('rejects a full URL with no path before any HTTP call', async () => {
		const exec = fakeExec({
			domain: DOMAIN,
			identifyBy: 'path',
			pathsDates: { link: [{ path: 'https://s.example', createdAt: '2026-08-17T16:16:06.000Z' }] },
		});
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/missing a path/);
		expect(calls(exec)).toHaveLength(0);
	});

	it('rejects a start date after the end date', async () => {
		const exec = fakeExec({
			domain: DOMAIN,
			identifyBy: 'id',
			linkIds: 'lnk_a1',
			dateRange: { startDate: '2026-09-10T00:00:00Z', endDate: '2026-09-01T00:00:00Z' },
		});
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/must not be after/);
		expect(calls(exec)).toHaveLength(0);
	});

	it('does not false-positive when end has a fractional second and start does not (regression: lexical > on instant strings)', async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				identifyBy: 'id',
				linkIds: 'lnk_a1',
				dateRange: { startDate: '2026-09-01T10:00:00Z', endDate: '2026-09-01T10:00:00.5Z' },
			},
			[{ statusCode: 200, body: { lnk_a1: 1 } }],
		);
		await run('getLinkClicks', exec);
		const [opts] = calls(exec);
		expect(opts.qs).toEqual({
			ids: 'lnk_a1',
			startDate: '2026-09-01T10:00:00.000Z',
			endDate: '2026-09-01T10:00:00.500Z',
		});
	});
});

describe('get raw clicks', () => {
	it('posts last_clicks and outputs one item per click', async () => {
		const exec = fakeExec(
			{ domain: DOMAIN, limit: 2, options: { beforeDate: '2026-09-10T12:44:55.000Z' } },
			[
				{
					statusCode: 200,
					body: [
						{ dt: '2026-09-10T12:44:50.000Z', path: '/a' },
						{ dt: '2026-09-10T12:44:40.000Z', path: '/b' },
					],
				},
			],
		);

		const items = await run('getRawClicks', exec);

		const [opts] = calls(exec);
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123/last_clicks');
		expect(opts.body).toEqual({
			limit: 2,
			beforeDate: '2026-09-10T12:44:55.000Z',
			period: 'last30',
			tz: 'Europe/Berlin',
		});
		expect(items.map((i) => i.json.path)).toEqual(['/a', '/b']);
	});

	it('unwraps an array nested in an object response', async () => {
		const exec = fakeExec({ domain: DOMAIN }, [
			{ statusCode: 200, body: { clicks: [{ path: '/a' }, { path: '/b' }] } },
		]);
		expect(await run('getRawClicks', exec)).toHaveLength(2);
	});

	it("interprets a zone-less cursor date as wall-clock time in this request's own resolved tz, not a fixed/host one", async () => {
		// This sandbox's own host process happens to default to Asia/Jerusalem, so asserting only
		// that one tz wouldn't distinguish the fix from the old host-TZ-dependent bug — checking two
		// different explicit Timezone values proves the result tracks the resolved tz.
		const runWithTz = async (timezone: string) => {
			const exec = fakeExec(
				{ domain: DOMAIN, timezone, options: { beforeDate: '2026-09-25T12:00:00' } },
				[{ statusCode: 200, body: [] }],
			);
			await run('getRawClicks', exec);
			const [opts] = calls(exec);
			return (opts.body as { beforeDate: string }).beforeDate;
		};

		expect(await runWithTz('Asia/Jerusalem')).toBe('2026-09-25T09:00:00.000Z');
		expect(await runWithTz('America/New_York')).toBe('2026-09-25T16:00:00.000Z');
	});

	it('outputs a lone click object as one item', async () => {
		const exec = fakeExec({ domain: DOMAIN }, [{ statusCode: 200, body: { path: '/a' } }]);
		expect(await run('getRawClicks', exec)).toEqual([{ json: { path: '/a' } }]);
	});
});

describe('link statistics', () => {
	const LINK = { __rl: true, mode: 'id', value: 'lnk_abc_123' };

	it('uses GET on the statistics host with skipTops in the query when no filters are set', async () => {
		const exec = fakeExec(
			{ link: LINK, period: 'week', options: { skipTops: true, clicksChartInterval: 'day' } },
			[{ statusCode: 200, body: { totalClicks: 7 } }],
		);

		const items = await run('getLinkStatistics', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('GET');
		expect(opts.url).toBe('https://statistics.short.io/statistics/link/lnk_abc_123');
		expect(opts.qs).toEqual({
			period: 'week',
			tz: 'Europe/Berlin',
			clicksChartInterval: 'day',
			skipTops: true,
		});
		expect(opts.body).toBeUndefined();
		expect(items).toEqual([{ json: { totalClicks: 7 } }]);
	});

	it('uses POST with filters and skipTops in the body when filters are set', async () => {
		const exec = fakeExec(
			{
				link: LINK,
				filters: { exclude: { columns: { human: false } } },
				options: { skipTops: false },
			},
			[{ statusCode: 200, body: { totalClicks: 1 } }],
		);

		await run('getLinkStatistics', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.qs).toBeUndefined();
		expect(opts.body).toEqual({
			period: 'last30',
			tz: 'Europe/Berlin',
			skipTops: false,
			exclude: { human: false },
		});
	});

	it('posts link by_interval with clicksChartInterval', async () => {
		const exec = fakeExec({ link: LINK, clicksChartInterval: 'month' }, [
			{ statusCode: 200, body: { clickStatistics: [] } },
		]);

		await run('getLinkStatisticsByInterval', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.url).toBe('https://statistics.short.io/statistics/link/lnk_abc_123/by_interval');
		expect(opts.body).toEqual({ period: 'last30', tz: 'Europe/Berlin', clicksChartInterval: 'month' });
	});

	it('resolves the link, then posts domain top values scoped to its path', async () => {
		const exec = fakeExec({ link: LINK, column: 'browser', limit: 3 }, [
			{ statusCode: 200, body: { path: 'abc123', DomainId: 55 } },
			{ statusCode: 200, body: [{ score: 2, column: 'Chrome', displayName: 'Chrome' }] },
		]);

		const items = await run('getLinkTopValues', exec);

		const [linkOpts, topOpts] = calls(exec);
		expect(linkOpts).toMatchObject({ method: 'GET', url: 'https://api.short.io/links/lnk_abc_123' });
		expect(topOpts).toMatchObject({
			method: 'POST',
			url: 'https://statistics.short.io/statistics/domain/55/top',
		});
		expect(topOpts.body).toEqual({
			column: 'browser',
			limit: 3,
			period: 'last30',
			tz: 'Europe/Berlin',
			include: { paths: ['/abc123'] },
		});
		expect(items).toHaveLength(1);
	});

	it('merges the link path into an existing include filter without dropping other columns', async () => {
		const exec = fakeExec(
			{ link: LINK, column: 'browser', filters: { include: { columns: { human: true } } } },
			[
				{ statusCode: 200, body: { path: 'abc123', DomainId: 55 } },
				{ statusCode: 200, body: [] },
			],
		);

		await run('getLinkTopValues', exec);

		const [, topOpts] = calls(exec);
		expect(topOpts.body).toMatchObject({ include: { human: true, paths: ['/abc123'] } });
	});

	it('intersects an existing include.paths that already contains the link path', async () => {
		const exec = fakeExec(
			{ link: LINK, column: 'browser', filters: { include: { columns: { paths: '/abc123,/other' } } } },
			[
				{ statusCode: 200, body: { path: 'abc123', DomainId: 55 } },
				{ statusCode: 200, body: [] },
			],
		);

		await run('getLinkTopValues', exec);

		const [, topOpts] = calls(exec);
		expect(topOpts.body).toMatchObject({ include: { paths: ['/abc123'] } });
	});

	it('returns an empty result without a second request when include.paths excludes the link', async () => {
		const exec = fakeExec(
			{ link: LINK, column: 'browser', filters: { include: { columns: { paths: '/other' } } } },
			[{ statusCode: 200, body: { path: 'abc123', DomainId: 55 } }],
		);

		const items = await run('getLinkTopValues', exec);

		expect(items).toEqual([]);
		expect(calls(exec)).toHaveLength(1);
	});

	it("normalizes the user's include.paths to add a missing leading slash before intersecting", async () => {
		const exec = fakeExec(
			{ link: LINK, column: 'browser', filters: { include: { columns: { paths: 'abc123,other' } } } },
			[
				{ statusCode: 200, body: { path: 'abc123', DomainId: 55 } },
				{ statusCode: 200, body: [] },
			],
		);

		await run('getLinkTopValues', exec);

		const [, topOpts] = calls(exec);
		expect(topOpts.body).toMatchObject({ include: { paths: ['/abc123'] } });
	});

	it('throws when the link response is missing DomainId, with no second request', async () => {
		const exec = fakeExec({ link: LINK, column: 'browser' }, [
			{ statusCode: 200, body: { path: 'abc123' } },
		]);
		await expect(run('getLinkTopValues', exec)).rejects.toThrow(
			'Short.io returned link lnk_abc_123 without a domain or path',
		);
		expect(calls(exec)).toHaveLength(1);
	});

	it('throws when the link response is missing path, with no second request', async () => {
		const exec = fakeExec({ link: LINK, column: 'browser' }, [
			{ statusCode: 200, body: { DomainId: 55 } },
		]);
		await expect(run('getLinkTopValues', exec)).rejects.toThrow(
			'Short.io returned link lnk_abc_123 without a domain or path',
		);
		expect(calls(exec)).toHaveLength(1);
	});

	it('reuses the /links/expand result in URL mode, skipping the extra GET /links/{id}', async () => {
		const exec = fakeExec(
			{ link: { __rl: true, mode: 'url', value: 'https://s.example/abc123' }, column: 'browser' },
			[
				{ statusCode: 200, body: { idString: 'lnk_abc_123', path: 'abc123', DomainId: 55 } },
				{ statusCode: 200, body: [] },
			],
		);

		await run('getLinkTopValues', exec);

		expect(calls(exec)).toHaveLength(2);
		const [expandOpts, topOpts] = calls(exec);
		expect(expandOpts).toMatchObject({ method: 'GET', url: 'https://api.short.io/links/expand' });
		expect(topOpts).toMatchObject({
			method: 'POST',
			url: 'https://statistics.short.io/statistics/domain/55/top',
		});
	});

	it.each(['getLinkStatistics', 'getLinkStatisticsByInterval', 'getLinkTopValues'])(
		'%s rejects an invalid link id before any HTTP call',
		async (operation) => {
			const exec = fakeExec({ link: { __rl: true, mode: 'id', value: '../domain/1' }, column: 'path' });
			await expect(run(operation, exec)).rejects.toThrow(/not a valid link ID/);
			expect(calls(exec)).toHaveLength(0);
		},
	);

	it('validates the period before resolving a short URL link', async () => {
		const exec = fakeExec({
			link: { __rl: true, mode: 'url', value: 'https://s.example/abc' },
			period: 'custom',
			startDate: '2026-09-10',
			endDate: '2026-09-01',
		});
		await expect(run('getLinkStatistics', exec)).rejects.toThrow(/must not be after/);
		expect(calls(exec)).toHaveLength(0);
	});
});
