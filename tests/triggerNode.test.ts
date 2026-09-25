import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataObject, IPollFunctions } from 'n8n-workflow';

import { ShortIoTrigger } from '../nodes/ShortIoTrigger/ShortIoTrigger.node';
import { clickKey } from '../shared/trigger';
import { fakeCtx, type Resp } from './helpers';

const DOMAIN = { __rl: true, mode: 'id', value: '42' };

function fakePoll(
	params: Record<string, unknown>,
	responses: Resp[],
	staticData: IDataObject,
	mode: 'trigger' | 'manual' = 'trigger',
): IPollFunctions {
	return fakeCtx(responses, {
		getNodeParameter: (name: string, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getWorkflowStaticData: () => staticData,
		getMode: () => mode,
		logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
	}) as unknown as IPollFunctions;
}

function calls(ctx: IPollFunctions) {
	return (
		ctx.helpers.httpRequestWithAuthentication as unknown as { mock: { calls: unknown[][] } }
	).mock.calls.map(
		(c) => c[1] as { method: string; url: string; qs?: IDataObject; body?: IDataObject },
	);
}

const trigger = new ShortIoTrigger();
const poll = (ctx: IPollFunctions) => trigger.poll.call(ctx);
const ids = (out: Awaited<ReturnType<typeof poll>>) => out![0].map((i) => i.json.idString);
const iso = (ms: number) => new Date(ms).toISOString();

const linksPage = (links: IDataObject[], nextPageToken: string | null = null): Resp => ({
	statusCode: 200,
	body: { count: links.length, links, nextPageToken },
});
const L1 = { idString: 'lnk_1', createdAt: '2026-09-25T10:00:00.000Z' };
const L2 = { idString: 'lnk_2', createdAt: '2026-09-25T10:05:00.000Z' };
const L3 = { idString: 'lnk_3', createdAt: '2026-09-25T10:06:00.000Z' };

describe('ShortIoTrigger description', () => {
	it('is a polling trigger without tool usage', () => {
		const d = trigger.description;
		expect(d.name).toBe('shortIoTrigger');
		expect(d.displayName).toBe('Short.io Trigger');
		expect(d.polling).toBe(true);
		expect(d.inputs).toEqual([]);
		expect(d.group).toEqual(['trigger']);
		expect(d.usableAsTool).toBeUndefined();
		expect(d.credentials).toEqual([{ name: 'shortIoApi', required: true }]);
	});
});

describe('ShortIoTrigger New Link', () => {
	const params = { event: 'newLink', domain: DOMAIN };
	const activated = (mark: string, idsAtMark: string[]): IDataObject => ({
		newLink: { domainId: 42, mark, idsAtMark },
	});

	it('first activation fetches one desc page, saves the mark and emits nothing', async () => {
		const state: IDataObject = {};
		const ctx = fakePoll(params, [linksPage([L1], 'more')], state);

		expect(await poll(ctx)).toBeNull();
		expect(state.newLink).toEqual({ domainId: 42, mark: L1.createdAt, idsAtMark: ['lnk_1'] });
		expect(calls(ctx)).toHaveLength(1);
		const [req] = calls(ctx);
		expect(req.method).toBe('GET');
		expect(req.url).toBe('https://api.short.io/api/links');
		expect(req.qs).toEqual({ domain_id: 42, dateSortOrder: 'desc', limit: 150 });
	});

	it('later polls ask asc with afterDate one millisecond before the mark', async () => {
		const state: IDataObject = {};
		await poll(fakePoll(params, [linksPage([L1])], state));

		const ctx = fakePoll(params, [linksPage([L1, L2, L3])], state);
		const out = await poll(ctx);
		expect(ids(out)).toEqual(['lnk_2', 'lnk_3']);
		expect(calls(ctx)[0].qs).toEqual({
			domain_id: 42,
			dateSortOrder: 'asc',
			limit: 150,
			afterDate: '2026-09-25T09:59:59.999Z',
		});

		expect(await poll(fakePoll(params, [linksPage([L3])], state))).toBeNull();
	});

	it('emits a new link tied with the mark exactly once', async () => {
		const tie = { idString: 'lnk_9', createdAt: L1.createdAt };
		const state = activated(L1.createdAt, ['lnk_1']);

		expect(ids(await poll(fakePoll(params, [linksPage([L1, tie])], state)))).toEqual(['lnk_9']);
		expect(await poll(fakePoll(params, [linksPage([L1, tie])], state))).toBeNull();
	});

	it('caps a burst at 10 pages and continues from the new mark on the next poll', async () => {
		const base = Date.parse('2026-09-25T11:00:00.000Z');
		const all = Array.from({ length: 1505 }, (_, n) => ({
			idString: `lnk_b${n}`,
			createdAt: iso(base + n * 1000),
		}));
		const pages = Array.from({ length: 11 }, (_, p) =>
			linksPage(all.slice(p * 150, p * 150 + 150), `tok${p + 1}`),
		);
		const state = activated(L1.createdAt, ['lnk_1']);

		const first = fakePoll(params, pages, state);
		const out1 = await poll(first);
		expect(calls(first)).toHaveLength(10);
		expect(calls(first)[9].qs).toMatchObject({ pageToken: 'tok9' });
		expect(ids(out1)).toEqual(all.slice(0, 1500).map((l) => l.idString));
		const newest = all[1499].createdAt;
		expect(state.newLink).toEqual({ domainId: 42, mark: newest, idsAtMark: ['lnk_b1499'] });

		const second = fakePoll(params, [linksPage(all.slice(1499))], state);
		const out2 = await poll(second);
		expect(calls(second)[0].qs).toMatchObject({
			dateSortOrder: 'asc',
			afterDate: iso(Date.parse(newest) - 1),
		});
		expect(ids(out2)).toEqual(all.slice(1500).map((l) => l.idString));
	});

	it('manual mode returns the newest link and leaves state untouched', async () => {
		const state = activated(L1.createdAt, ['lnk_1']);
		const before = structuredClone(state);
		const ctx = fakePoll(params, [linksPage([L2])], state, 'manual');

		expect(await poll(ctx)).toEqual([[{ json: L2 }]]);
		expect(state).toEqual(before);
		expect(calls(ctx)[0].qs).toEqual({ domain_id: 42, dateSortOrder: 'desc', limit: 1 });
	});

	it('manual mode returns null when there are no links', async () => {
		const state: IDataObject = {};
		expect(await poll(fakePoll(params, [linksPage([])], state, 'manual'))).toBeNull();
		expect(state).toEqual({});
	});

	it('a domain change resets the state like a first activation', async () => {
		const state: IDataObject = {
			newLink: { domainId: 7, mark: L1.createdAt, idsAtMark: ['lnk_1'] },
		};
		const ctx = fakePoll(params, [linksPage([L2])], state);

		expect(await poll(ctx)).toBeNull();
		expect(calls(ctx)[0].qs).toEqual({ domain_id: 42, dateSortOrder: 'desc', limit: 150 });
		expect(state.newLink).toEqual({ domainId: 42, mark: L2.createdAt, idsAtMark: ['lnk_2'] });
	});

	it('rejects an invalid domain id', async () => {
		const ctx = fakePoll(
			{ event: 'newLink', domain: { __rl: true, mode: 'id', value: '../x' } },
			[],
			{},
		);
		await expect(poll(ctx)).rejects.toThrow('Domain ID');
	});
});

describe('ShortIoTrigger New Click', () => {
	const params = { event: 'newClick', domain: DOMAIN };
	const URL = 'https://statistics.short.io/statistics/domain/42/last_clicks';
	const T0 = Date.parse('2026-09-25T10:00:00.000Z');
	// Fixed "now" for every test in this block, comfortably after every click/mark used below
	// (up to +2100s), so a later poll's `endDate: <now>` is deterministic.
	const NOW = T0 + 3_000_000;
	/** A click `s` seconds after T0, with a distinct ip. */
	const clickAt = (s: number, ip = `10.0.0.${s}`) => ({
		dt: iso(T0 + s * 1000),
		ip,
		path: '/a',
		ua: 'UA',
	});
	/** Clicks for seconds from..to (inclusive), newest first. */
	const range = (from: number, to: number) =>
		Array.from({ length: from - to + 1 }, (_, n) => clickAt(from - n));
	const clicks = (list: IDataObject[]): Resp => ({ statusCode: 200, body: list });
	const activated = (markS: number, keys: string[] = []): IDataObject => ({
		newClick: { domainId: 42, mark: iso(T0 + markS * 1000), keysAtMark: keys },
	});
	const dts = (out: Awaited<ReturnType<typeof poll>>) => out![0].map((i) => i.json.dt);

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('first activation reads one page with period total and sets the mark', async () => {
		const state: IDataObject = {};
		const ctx = fakePoll(params, [clicks(range(200, 101)), clicks(range(100, 1))], state);

		expect(await poll(ctx)).toBeNull();
		expect(calls(ctx)).toHaveLength(1);
		expect(calls(ctx)[0]).toMatchObject({ method: 'POST', url: URL });
		expect(calls(ctx)[0].body).toEqual({ limit: 100, period: 'total', tz: 'UTC' });
		expect(state.newClick).toEqual({
			domainId: 42,
			mark: clickAt(200).dt,
			keysAtMark: [clickKey(clickAt(200))],
		});
	});

	it('later polls send period custom with cursors at mark - 1s and endDate now, and emit newer clicks oldest first', async () => {
		const state = activated(0, [clickKey(clickAt(0))]);
		const ctx = fakePoll(params, [clicks([clickAt(2), clickAt(1), clickAt(0)])], state);

		expect(dts(await poll(ctx))).toEqual([clickAt(1).dt, clickAt(2).dt]);
		expect(calls(ctx)[0].body).toEqual({
			limit: 100,
			period: 'custom',
			startDate: iso(T0 - 1000),
			endDate: iso(NOW),
			afterDate: iso(T0 - 1000),
			tz: 'UTC',
		});
		expect(state.newClick).toMatchObject({ mark: clickAt(2).dt });
	});

	it('pages backwards with beforeDate cursors (oldest + 1 ms) until a short page', async () => {
		const state = activated(-100);
		const ctx = fakePoll(
			params,
			[clicks(range(250, 151)), clicks(range(151, 52)), clicks(range(51, 1))],
			state,
		);

		const out = await poll(ctx);
		const bodies = calls(ctx).map((c) => c.body);
		expect(bodies).toHaveLength(3);
		expect(bodies[0]).toMatchObject({
			period: 'custom',
			startDate: iso(T0 - 101_000),
			endDate: iso(NOW),
			afterDate: iso(T0 - 101_000),
		});
		expect(bodies[0]).not.toHaveProperty('beforeDate');
		expect(bodies[1]).toMatchObject({
			beforeDate: iso(T0 + 151_001),
			afterDate: iso(T0 - 101_000),
		});
		expect(bodies[2]).toMatchObject({ beforeDate: iso(T0 + 52_001), afterDate: iso(T0 - 101_000) });
		expect(dts(out)).toEqual(
			range(250, 1)
				.reverse()
				.map((c) => c.dt),
		);
	});

	it('stops paging once a page reaches the mark', async () => {
		const state = activated(100, [clickKey(clickAt(100))]);
		const ctx = fakePoll(params, [clicks(range(199, 100)), clicks(range(99, 0))], state);

		const out = await poll(ctx);
		expect(calls(ctx)).toHaveLength(1);
		expect(dts(out)).toEqual(
			range(199, 101)
				.reverse()
				.map((c) => c.dt),
		);
	});

	it('stops paging and warns when a full page adds no new clicks while still newer than the mark', async () => {
		const state = activated(-100);
		const page = range(199, 100);
		const ctx = fakePoll(params, [clicks(page), clicks(page), clicks(range(99, 0))], state);

		const out = await poll(ctx);
		expect(calls(ctx)).toHaveLength(2);
		expect(out![0]).toHaveLength(100);
		expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
		expect(
			String((ctx.logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]),
		).toMatch(/full page with no new clicks/);
	});

	it('stops at 20 pages, logs a warning, and still emits and advances the mark', async () => {
		const state = activated(-100);
		const pages = Array.from({ length: 21 }, (_, p) =>
			clicks(range(2100 - p * 100, 2001 - p * 100)),
		);
		const ctx = fakePoll(params, pages, state);

		const out = await poll(ctx);
		expect(calls(ctx)).toHaveLength(20);
		expect(out![0]).toHaveLength(2000);
		expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
		expect(
			String((ctx.logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]),
		).toContain('2000');
		expect(state.newClick).toMatchObject({ mark: clickAt(2100).dt });
	});

	it('manual mode returns one click without touching state', async () => {
		const state: IDataObject = {};
		const ctx = fakePoll(params, [clicks([clickAt(5)])], state, 'manual');
		expect(await poll(ctx)).toEqual([[{ json: clickAt(5) }]]);
		expect(state).toEqual({});
		expect(calls(ctx)[0].body).toEqual({ limit: 1, period: 'total', tz: 'UTC' });
	});
});
