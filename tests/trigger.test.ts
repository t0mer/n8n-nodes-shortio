import { describe, expect, it } from 'vitest';

import { clickKey, selectNewClicks, selectNewLinks } from '../shared/trigger';

const link = (idString: string, createdAt: unknown) => ({ idString, createdAt });
const click = (dt: string, ip: string, path = '/a', ua = 'UA') => ({ dt, ip, path, ua });

describe('selectNewLinks', () => {
	it('treats every link as fresh when there is no mark', () => {
		const links = [
			link('lnk_b', '2026-09-25T10:00:01.000Z'),
			link('lnk_a', '2026-09-25T10:00:00.000Z'),
		];
		const { fresh, next } = selectNewLinks(links, { idsAtMark: [] });
		expect(fresh.map((l) => l.idString)).toEqual(['lnk_a', 'lnk_b']);
		expect(next).toEqual({ mark: '2026-09-25T10:00:01.000Z', idsAtMark: ['lnk_b'] });
	});

	it('returns fresh links sorted ascending by createdAt', () => {
		const links = [
			link('lnk_c', '2026-09-25T10:00:03.000Z'),
			link('lnk_a', '2026-09-25T10:00:01.000Z'),
			link('lnk_b', '2026-09-25T10:00:02.000Z'),
		];
		const { fresh } = selectNewLinks(links, { mark: '2026-09-25T10:00:00.000Z', idsAtMark: [] });
		expect(fresh.map((l) => l.idString)).toEqual(['lnk_a', 'lnk_b', 'lnk_c']);
	});

	it('drops links older than the mark and links at the mark already seen', () => {
		const mark = '2026-09-25T10:00:00.000Z';
		const links = [link('lnk_old', '2026-09-25T09:00:00.000Z'), link('lnk_seen', mark)];
		const { fresh, next } = selectNewLinks(links, { mark, idsAtMark: ['lnk_seen'] });
		expect(fresh).toEqual([]);
		expect(next).toEqual({ mark, idsAtMark: ['lnk_seen'] });
	});

	it('emits a new link tied with the mark exactly once', () => {
		const mark = '2026-09-25T10:00:00.000Z';
		const links = [link('lnk_seen', mark), link('lnk_tie', mark)];
		const first = selectNewLinks(links, { mark, idsAtMark: ['lnk_seen'] });
		expect(first.fresh.map((l) => l.idString)).toEqual(['lnk_tie']);
		expect(first.next.mark).toBe(mark);
		expect([...first.next.idsAtMark].sort()).toEqual(['lnk_seen', 'lnk_tie']);

		const second = selectNewLinks(links, first.next);
		expect(second.fresh).toEqual([]);
		expect(second.next).toEqual(first.next);
	});

	it('merges old ids at the mark when the mark does not move', () => {
		const mark = '2026-09-25T10:00:00.000Z';
		const { next } = selectNewLinks([link('lnk_new', mark)], { mark, idsAtMark: ['lnk_gone'] });
		expect([...next.idsAtMark].sort()).toEqual(['lnk_gone', 'lnk_new']);
	});

	it('replaces the ids at the mark when the mark moves forward', () => {
		const { next } = selectNewLinks(
			[link('lnk_x', '2026-09-25T10:00:05.000Z'), link('lnk_y', '2026-09-25T10:00:05.000Z')],
			{ mark: '2026-09-25T10:00:00.000Z', idsAtMark: ['lnk_old'] },
		);
		expect(next.mark).toBe('2026-09-25T10:00:05.000Z');
		expect([...next.idsAtMark].sort()).toEqual(['lnk_x', 'lnk_y']);
	});

	it('compares dates by value, not by string format', () => {
		const ms = Date.parse('2026-09-25T10:00:00.000Z');
		const { fresh } = selectNewLinks(
			[
				link('lnk_ms', ms),
				link('lnk_offset', '2026-09-25T12:00:00+02:00'),
				link('lnk_later', ms + 1),
			],
			{ mark: '2026-09-25T10:00:00.000Z', idsAtMark: ['lnk_ms'] },
		);
		expect(fresh.map((l) => l.idString)).toEqual(['lnk_offset', 'lnk_later']);
	});

	it('skips links with an unparseable createdAt', () => {
		const { fresh, next } = selectNewLinks(
			[
				link('lnk_bad', 'not a date'),
				link('lnk_null', null),
				link('lnk_ok', '2026-09-25T10:00:00.000Z'),
			],
			{ idsAtMark: [] },
		);
		expect(fresh.map((l) => l.idString)).toEqual(['lnk_ok']);
		expect(next).toEqual({ mark: '2026-09-25T10:00:00.000Z', idsAtMark: ['lnk_ok'] });
	});

	it('keeps the state when nothing was fetched', () => {
		const state = { mark: '2026-09-25T10:00:00.000Z', idsAtMark: ['lnk_a'] };
		expect(selectNewLinks([], state)).toEqual({ fresh: [], next: state });
		expect(selectNewLinks([], { idsAtMark: [] })).toEqual({ fresh: [], next: { idsAtMark: [] } });
	});

	it('emits a link repeated across pages only once', () => {
		const l = link('lnk_a', '2026-09-25T10:00:00.000Z');
		expect(selectNewLinks([l, { ...l }], { idsAtMark: [] }).fresh).toHaveLength(1);
	});

	it('skips links with neither idString nor id', () => {
		const { fresh, next } = selectNewLinks(
			[{ createdAt: '2026-09-25T10:00:09.000Z' }, link('lnk_a', '2026-09-25T10:00:00.000Z')],
			{ idsAtMark: [] },
		);
		expect(fresh.map((l) => l.idString)).toEqual(['lnk_a']);
		expect(next).toEqual({ mark: '2026-09-25T10:00:00.000Z', idsAtMark: ['lnk_a'] });
	});
});

describe('clickKey', () => {
	it('joins dt, ip, path, ua, method, st and refhost', () => {
		expect(
			clickKey({
				...click('2026-09-25T10:00:00.000Z', '1.2.3.4', '/abc', 'Mozilla'),
				method: 'GET',
				st: 301,
				refhost: 'example.com',
			}),
		).toBe('2026-09-25T10:00:00.000Z|1.2.3.4|/abc|Mozilla|GET|301|example.com');
	});

	it('uses an empty string for missing fields', () => {
		expect(clickKey({ dt: '2026-09-25T10:00:00.000Z' })).toBe('2026-09-25T10:00:00.000Z||||||');
	});
});

describe('selectNewClicks', () => {
	const mark = '2026-09-25T10:00:00.000Z';

	it('treats every click as fresh when there is no mark, sorted ascending', () => {
		const clicks = [click('2026-09-25T10:00:02.000Z', 'b'), click('2026-09-25T10:00:01.000Z', 'a')];
		const { fresh, next } = selectNewClicks(clicks, { keysAtMark: [] });
		expect(fresh.map((c) => c.ip)).toEqual(['a', 'b']);
		expect(next).toEqual({
			mark: '2026-09-25T10:00:02.000Z',
			keysAtMark: [clickKey(clicks[0])],
		});
	});

	it('distinguishes two clicks with the same dt but a different ip', () => {
		const a = click(mark, '1.1.1.1');
		const b = click(mark, '2.2.2.2');
		const first = selectNewClicks([a, b], { mark, keysAtMark: [clickKey(a)] });
		expect(first.fresh).toEqual([b]);
		expect([...first.next.keysAtMark].sort()).toEqual([clickKey(a), clickKey(b)].sort());

		const second = selectNewClicks([a, b], first.next);
		expect(second.fresh).toEqual([]);
	});

	it('merges old keys at the mark when the mark does not move', () => {
		const c = click(mark, '3.3.3.3');
		const { next } = selectNewClicks([c], { mark, keysAtMark: ['old'] });
		expect([...next.keysAtMark].sort()).toEqual(['old', clickKey(c)].sort());
	});

	it('advances the mark and emits newer clicks', () => {
		const later = click('2026-09-25T10:00:09.000Z', '4.4.4.4');
		const { fresh, next } = selectNewClicks([click(mark, 'x'), later], {
			mark,
			keysAtMark: [clickKey(click(mark, 'x'))],
		});
		expect(fresh).toEqual([later]);
		expect(next).toEqual({ mark: later.dt, keysAtMark: [clickKey(later)] });
	});

	it('skips clicks with an unparseable dt', () => {
		const { fresh } = selectNewClicks([{ ip: 'x', path: '/a' }, click('garbage', 'y')], {
			keysAtMark: [],
		});
		expect(fresh).toEqual([]);
	});
});
