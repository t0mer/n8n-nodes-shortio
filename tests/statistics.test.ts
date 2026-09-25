import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import {
	buildPeriod,
	buildStatsFilters,
	buildTimezone,
	toStatsDateTime,
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

describe('toStatsDateTime', () => {
	// The live API rejects a zone-less date-time with a 400. September is deliberately chosen for
	// Asia/Jerusalem: IDT (daylight saving) is +03:00 then, unlike the +02:00 winter offset (IST).
	it("attaches the given tz's own offset to a zone-less string", () => {
		expect(toStatsDateTime('2026-09-25T23:59:00', 'Asia/Jerusalem')).toBe(
			'2026-09-25T23:59:00+03:00',
		);
	});

	it('trims a zone-less string before interpreting it', () => {
		expect(toStatsDateTime(' 2026-09-25T23:59:00 ', 'UTC')).toBe('2026-09-25T23:59:00+00:00');
	});

	it('keeps a Z-suffixed string unchanged', () => {
		expect(toStatsDateTime('2026-09-25T23:59:00.000Z', 'Asia/Jerusalem')).toBe(
			'2026-09-25T23:59:00.000Z',
		);
	});

	it('keeps an explicit-offset string unchanged, preserving the given offset', () => {
		expect(toStatsDateTime('2026-09-25T23:59:00+02:00', 'Asia/Jerusalem')).toBe(
			'2026-09-25T23:59:00+02:00',
		);
	});

	it("uses a Luxon-like value's own .toISO(), keeping its offset", () => {
		const fakeDateTime = { toISO: () => '2026-09-25T23:59:00.000+02:00' };
		expect(toStatsDateTime(fakeDateTime, 'Asia/Jerusalem')).toBe('2026-09-25T23:59:00.000+02:00');
	});

	it('converts a Date/epoch value via toIsoDate, same as before', () => {
		expect(toStatsDateTime(new Date('2026-09-25T23:59:00.000Z'), 'Asia/Jerusalem')).toBe(
			'2026-09-25T23:59:00.000Z',
		);
	});

	it('throws on an unparseable zone-less string', () => {
		expect(() => toStatsDateTime('not a date', 'UTC')).toThrow('Invalid date: not a date');
	});

	it('returns undefined for empty values', () => {
		expect(toStatsDateTime('', 'UTC')).toBeUndefined();
		expect(toStatsDateTime(undefined, 'UTC')).toBeUndefined();
		expect(toStatsDateTime(null, 'UTC')).toBeUndefined();
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

	it('sends full ISO start and end date-times for custom', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-01T00:00:00.000Z',
			endDate: '2026-09-15T23:59:59.000Z',
		});
		expect(buildPeriod(exec, 0, 'UTC')).toEqual({
			period: 'custom',
			startDate: '2026-09-01T00:00:00.000Z',
			endDate: '2026-09-15T23:59:59.000Z',
		});
	});

	it('accepts equal start and end dates', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-01', endDate: '2026-09-01' });
		expect(buildPeriod(exec, 0, 'UTC').startDate).toBe('2026-09-01T00:00:00+00:00');
	});

	it('attaches the Timezone parameter offset to a zone-less start/end date-time', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-25T23:59:00',
			endDate: '2026-09-26T00:00:00',
		});
		expect(buildPeriod(exec, 0, 'Asia/Jerusalem')).toEqual({
			period: 'custom',
			startDate: '2026-09-25T23:59:00+03:00',
			endDate: '2026-09-26T00:00:00+03:00',
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

	it('rejects custom without both dates', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-15' });
		expect(() => buildPeriod(exec, 0, 'UTC')).toThrow(NodeOperationError);
	});
});

describe('buildTimezone', () => {
	it('uses the given IANA name, trimmed', () => {
		expect(buildTimezone(fakeExec({ timezone: ' Asia/Jerusalem ' }), 0)).toBe('Asia/Jerusalem');
	});

	it('falls back to the workflow timezone when empty', () => {
		expect(buildTimezone(fakeExec({ timezone: '' }), 0)).toBe('Europe/Berlin');
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
				dt: ['2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'],
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
			startDate: '2026-09-01T00:00:00+02:00',
			endDate: '2026-09-02T00:00:00+02:00',
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
	it("sends GET with ids CSV and optional dates in the query, in this.getTimezone()'s offset", async () => {
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
		// fakeExec's getTimezone() is 'Europe/Berlin', +02:00 (CEST) in September.
		expect(opts.qs).toEqual({
			ids: 'lnk_a1,link_b2',
			startDate: '2026-09-01T00:00:00+02:00',
			endDate: '2026-09-10T00:00:00+02:00',
		});
		expect(items).toEqual([{ json: { lnk_a1: 4, link_b2: 0 } }]);
	});

	it('rejects an invalid link id before any HTTP call', async () => {
		const exec = fakeExec({ domain: DOMAIN, identifyBy: 'id', linkIds: 'lnk_a1,../x' });
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/not a valid link ID/);
		expect(calls(exec)).toHaveLength(0);
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
		expect(opts.qs).toEqual({ startDate: '2026-09-01T00:00:00+02:00' });
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

	it("attaches this.getTimezone()'s offset to a zone-less Created At", async () => {
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
			pathsDates: [{ path: 'abc', createdAt: '2026-08-17T16:16:06+02:00' }],
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
