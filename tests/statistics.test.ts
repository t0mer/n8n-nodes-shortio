import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

import {
	buildPeriod,
	buildStatsFilters,
	buildTimezone,
	toStatsDate,
} from '../nodes/ShortIo/descriptions/statistics';
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

describe('toStatsDate', () => {
	it('keeps the calendar date of a zone-less n8n dateTime string', () => {
		expect(toStatsDate('2026-09-01T00:00:00')).toBe('2026-09-01');
	});

	it('slices an ISO date-time to YYYY-MM-DD and omits empty values', () => {
		expect(toStatsDate('2026-09-01T23:30:00.000Z')).toBe('2026-09-01');
		expect(toStatsDate('')).toBeUndefined();
	});

	it('throws on an unparseable date', () => {
		expect(() => toStatsDate('not a date')).toThrow();
	});
});

describe('buildPeriod', () => {
	it('returns only the period for a preset', () => {
		const exec = fakeExec({ period: 'last7', startDate: '2026-01-01' });
		expect(buildPeriod(exec, 0)).toEqual({ period: 'last7' });
	});

	it('defaults to last30', () => {
		expect(buildPeriod(fakeExec({}), 0)).toEqual({ period: 'last30' });
	});

	it('adds YYYY-MM-DD start and end dates for custom', () => {
		const exec = fakeExec({
			period: 'custom',
			startDate: '2026-09-01T00:00:00',
			endDate: '2026-09-15T00:00:00',
		});
		expect(buildPeriod(exec, 0)).toEqual({
			period: 'custom',
			startDate: '2026-09-01',
			endDate: '2026-09-15',
		});
	});

	it('accepts equal start and end dates', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-01', endDate: '2026-09-01' });
		expect(buildPeriod(exec, 0).startDate).toBe('2026-09-01');
	});

	it('rejects a start date after the end date', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-15', endDate: '2026-09-01' });
		expect(() => buildPeriod(exec, 0)).toThrow(/must not be after/);
	});

	it('rejects custom without both dates', () => {
		const exec = fakeExec({ period: 'custom', startDate: '2026-09-15' });
		expect(() => buildPeriod(exec, 0)).toThrow(NodeOperationError);
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
		const filters = buildStatsFilters({
			include: {
				columns: {
					browsers: ' Chrome, Firefox ,,Chrome',
					statuses: '301, 404',
					countries: ['us', 'IL'],
					dtStart: '2026-09-01T00:00:00',
					dtEnd: '2026-09-02T00:00:00',
					human: true,
				},
			},
			exclude: { columns: { refhosts: 'spam.example' } },
		});
		expect(filters).toEqual({
			include: {
				browsers: ['Chrome', 'Firefox'],
				statuses: [301, 404],
				countries: ['US', 'IL'],
				dt: ['2026-09-01', '2026-09-02'],
				human: true,
			},
			exclude: { refhosts: ['spam.example'] },
		});
	});

	it('drops empty filter sets', () => {
		expect(buildStatsFilters({})).toEqual({});
		expect(buildStatsFilters(undefined)).toEqual({});
		expect(
			buildStatsFilters({ include: { columns: { browsers: ' , ', countries: [] } }, exclude: {} }),
		).toEqual({});
	});

	it('keeps human=false as a meaningful value', () => {
		expect(buildStatsFilters({ exclude: { columns: { human: false } } })).toEqual({
			exclude: { human: false },
		});
	});

	it('rejects a non-numeric status', () => {
		expect(() => buildStatsFilters({ include: { columns: { statuses: '301, abc' } } })).toThrow(
			/not a valid HTTP status code/,
		);
	});

	it('rejects an invalid country code', () => {
		expect(() => buildStatsFilters({ include: { columns: { countries: ['USA'] } } })).toThrow(
			/not a valid country code/,
		);
	});

	it('rejects a half-set date range', () => {
		expect(() => buildStatsFilters({ include: { columns: { dtStart: '2026-09-01' } } })).toThrow(
			/both a start and an end/,
		);
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
			startDate: '2026-09-01',
			endDate: '2026-09-02',
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

	it('posts top_by_interval with interval and no prefix', async () => {
		const exec = fakeExec(
			{ domain: DOMAIN, column: 'path', interval: 'day', limit: 10, prefix: 'ignored' },
			[{ statusCode: 200, body: [] }],
		);

		await run('getDomainTopValuesByInterval', exec);

		const [opts] = calls(exec);
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123/top_by_interval');
		expect(opts.body).toEqual({
			column: 'path',
			interval: 'day',
			limit: 10,
			period: 'last30',
			tz: 'Europe/Berlin',
		});
	});
});

describe('get link clicks', () => {
	it('sends GET with ids CSV and optional dates in the query', async () => {
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
		expect(opts.qs).toEqual({ ids: 'lnk_a1,link_b2', startDate: '2026-09-01', endDate: '2026-09-10' });
		expect(items).toEqual([{ json: { lnk_a1: 4, link_b2: 0 } }]);
	});

	it('rejects an invalid link id before any HTTP call', async () => {
		const exec = fakeExec({ domain: DOMAIN, identifyBy: 'id', linkIds: 'lnk_a1,../x' });
		await expect(run('getLinkClicks', exec)).rejects.toThrow(/not a valid link ID/);
		expect(calls(exec)).toHaveLength(0);
	});

	it('sends POST with pathsDates in the body and dates in the query', async () => {
		const exec = fakeExec(
			{
				domain: DOMAIN,
				identifyBy: 'path',
				pathsDates: {
					link: [
						{ path: 'https://s.example/abc', createdAt: '2026-08-17T16:16:06.000Z' },
						{ path: ' https://s.example/def ', createdAt: '' },
					],
				},
				dateRange: { startDate: '2026-09-01' },
			},
			[{ statusCode: 200, body: { 'https://s.example/abc': 22 } }],
		);

		const items = await run('getLinkClicks', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('POST');
		expect(opts.qs).toEqual({ startDate: '2026-09-01' });
		expect(opts.body).toEqual({
			pathsDates: [
				{ path: 'https://s.example/abc', createdAt: '2026-08-17T16:16:06.000Z' },
				{ path: 'https://s.example/def' },
			],
		});
		expect(items).toEqual([{ json: { 'https://s.example/abc': 22 } }]);
	});

	it('rejects an empty path list', async () => {
		const exec = fakeExec({ domain: DOMAIN, identifyBy: 'path', pathsDates: {} });
		await expect(run('getLinkClicks', exec)).rejects.toThrow(NodeOperationError);
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

describe('clear domain statistics', () => {
	it('throws before any HTTP call when confirm is false', async () => {
		const exec = fakeExec({ domain: DOMAIN, confirm: false });
		await expect(run('clearDomainStatistics', exec)).rejects.toThrow(
			'Clear Domain Statistics is irreversible. Enable "Confirm" to proceed.',
		);
		expect(calls(exec)).toHaveLength(0);
	});

	it('checks confirm before validating the domain', async () => {
		const exec = fakeExec({ domain: { __rl: true, mode: 'id', value: 'bad' } });
		await expect(run('clearDomainStatistics', exec)).rejects.toThrow(/irreversible/);
	});

	it('sends DELETE with no body when confirmed', async () => {
		const exec = fakeExec({ domain: DOMAIN, confirm: true }, [
			{ statusCode: 200, body: { success: true } },
		]);

		const items = await run('clearDomainStatistics', exec);

		const [opts] = calls(exec);
		expect(opts.method).toBe('DELETE');
		expect(opts.url).toBe('https://statistics.short.io/statistics/domain/123/statistics');
		expect(opts.body).toBeUndefined();
		expect(items).toEqual([{ json: { success: true, domainId: 123 } }]);
	});
});
