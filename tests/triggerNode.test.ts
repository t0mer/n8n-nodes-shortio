import { describe, expect, it } from 'vitest';
import type { IDataObject, IPollFunctions } from 'n8n-workflow';

import { ShortIoTrigger } from '../nodes/ShortIoTrigger/ShortIoTrigger.node';
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

const linksPage = (links: IDataObject[], nextPageToken: string | null = null): Resp => ({
	statusCode: 200,
	body: { count: links.length, links, nextPageToken },
});
const L1 = { idString: 'lnk_1', createdAt: '2026-09-25T10:00:00.000Z' };
const L2 = { idString: 'lnk_2', createdAt: '2026-09-25T10:05:00.000Z' };
const L3 = { idString: 'lnk_3', createdAt: '2026-09-25T10:05:00.000Z' };

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

	it('first activation saves the mark and emits nothing', async () => {
		const state: IDataObject = {};
		const ctx = fakePoll(params, [linksPage([L1])], state);

		expect(await poll(ctx)).toBeNull();
		expect(state.newLink).toEqual({ domainId: 42, mark: L1.createdAt, idsAtMark: ['lnk_1'] });
		const [req] = calls(ctx);
		expect(req.method).toBe('GET');
		expect(req.url).toBe('https://api.short.io/api/links');
		expect(req.qs).toEqual({ domain_id: 42, dateSortOrder: 'desc', limit: 150 });
	});

	it('the next poll emits new links oldest first, then the poll after that emits nothing', async () => {
		const state: IDataObject = {};
		await poll(fakePoll(params, [linksPage([L1])], state));

		const ctx = fakePoll(params, [linksPage([L3, L2, L1])], state);
		const out = await poll(ctx);
		expect(out).toHaveLength(1);
		expect(out![0].map((i) => i.json.idString).sort()).toEqual(['lnk_2', 'lnk_3']);
		expect(calls(ctx)[0].qs).toMatchObject({ afterDate: L1.createdAt });

		expect(await poll(fakePoll(params, [linksPage([L3, L2])], state))).toBeNull();
	});

	it('follows nextPageToken', async () => {
		const state: IDataObject = {
			newLink: { domainId: 42, mark: L1.createdAt, idsAtMark: ['lnk_1'] },
		};
		const ctx = fakePoll(params, [linksPage([L3], 'tok'), linksPage([L2])], state);
		const out = await poll(ctx);
		expect(out![0]).toHaveLength(2);
		expect(calls(ctx)[1].qs).toMatchObject({ pageToken: 'tok' });
	});

	it('manual mode returns the newest link and leaves state untouched', async () => {
		const state: IDataObject = {
			newLink: { domainId: 42, mark: L1.createdAt, idsAtMark: ['lnk_1'] },
		};
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
		expect(calls(ctx)[0].qs).not.toHaveProperty('afterDate');
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
	const C1 = { dt: '2026-09-25T10:00:00.000Z', ip: '1.1.1.1', path: '/a', ua: 'UA' };
	const C2 = { dt: '2026-09-25T10:01:00.000Z', ip: '2.2.2.2', path: '/a', ua: 'UA' };
	const clicks = (list: IDataObject[]): Resp => ({ statusCode: 200, body: list });

	it('queries the statistics host and sends afterDate after the first activation', async () => {
		const state: IDataObject = {};
		const first = fakePoll(params, [clicks([C1])], state);
		expect(await poll(first)).toBeNull();
		const [firstReq] = calls(first);
		expect(firstReq.method).toBe('POST');
		expect(firstReq.url).toBe('https://statistics.short.io/statistics/domain/42/last_clicks');
		expect(firstReq.body).toEqual({ limit: 100, tz: 'UTC', period: 'total' });

		const second = fakePoll(params, [clicks([C2, C1])], state);
		expect(await poll(second)).toEqual([[{ json: C2 }]]);
		expect(calls(second)[0].body).toEqual({ limit: 100, tz: 'UTC', afterDate: C1.dt });
		expect(state.newClick).toMatchObject({ domainId: 42, mark: C2.dt });
	});

	it('manual mode returns one click without touching state', async () => {
		const state: IDataObject = {};
		const ctx = fakePoll(params, [clicks([C2])], state, 'manual');
		expect(await poll(ctx)).toEqual([[{ json: C2 }]]);
		expect(state).toEqual({});
		expect(calls(ctx)[0].body).toEqual({ limit: 1, tz: 'UTC', period: 'total' });
	});
});
