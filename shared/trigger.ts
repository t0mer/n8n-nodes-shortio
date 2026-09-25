import type { IDataObject } from 'n8n-workflow';

/** High-water mark for the New Link event: newest `createdAt` seen, plus the ids created at it. */
export interface LinkState {
	/** ISO `createdAt` of the newest link seen. */
	mark?: string;
	idsAtMark: string[];
}

/** High-water mark for the New Click event: newest `dt` seen, plus the click keys at it. */
export interface ClickState {
	/** ISO `dt` of the newest click seen. */
	mark?: string;
	keysAtMark: string[];
}

interface Mark {
	mark?: string;
	keys: string[];
}

/** Parses a date that may be an ISO string or epoch milliseconds. `NaN` when unusable. */
function toMs(value: unknown): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
	if (typeof value === 'string' && value.trim()) return Date.parse(value);
	return NaN;
}

/**
 * Shared high-water-mark selection. An item is fresh when its date is after the mark, or equal
 * to it with a key not yet seen at the mark. Items with an unparseable date are skipped. Fresh
 * items come back oldest first, each key at most once. The next mark is the newest date seen;
 * its keys are merged with the old ones when the mark did not move.
 */
function selectNew(
	items: IDataObject[],
	state: Mark,
	dateOf: (item: IDataObject) => unknown,
	keyOf: (item: IDataObject) => string,
): { fresh: IDataObject[]; next: Mark } {
	const markMs = state.mark !== undefined ? toMs(state.mark) : NaN;
	const hasMark = !Number.isNaN(markMs);
	const seenAtMark = new Set(state.keys);

	const dated: Array<{ item: IDataObject; ms: number; key: string }> = [];
	for (const item of items) {
		const ms = toMs(dateOf(item));
		if (Number.isNaN(ms)) continue;
		dated.push({ item, ms, key: keyOf(item) });
	}

	const emitted = new Set<string>();
	const fresh = dated
		.filter(({ ms, key }) => {
			if (hasMark && (ms < markMs || (ms === markMs && seenAtMark.has(key)))) return false;
			if (emitted.has(key)) return false;
			emitted.add(key);
			return true;
		})
		.sort((a, b) => a.ms - b.ms)
		.map(({ item }) => item);

	let maxMs = hasMark ? markMs : -Infinity;
	for (const { ms } of dated) if (ms > maxMs) maxMs = ms;
	if (maxMs === -Infinity) return { fresh, next: { keys: [...state.keys] } };

	const keysAtMax = dated.filter(({ ms }) => ms === maxMs).map(({ key }) => key);
	const keys = hasMark && maxMs === markMs ? [...state.keys, ...keysAtMax] : keysAtMax;
	return {
		fresh,
		next: {
			mark: hasMark && maxMs === markMs ? state.mark : new Date(maxMs).toISOString(),
			keys: [...new Set(keys)],
		},
	};
}

function withMark<T extends object>(mark: string | undefined, rest: T): T & { mark?: string } {
	return mark !== undefined ? { mark, ...rest } : rest;
}

/** Selects links created after the saved mark (see {@link selectNew}), oldest first. */
export function selectNewLinks(
	links: IDataObject[],
	state: LinkState,
): { fresh: IDataObject[]; next: LinkState } {
	const { fresh, next } = selectNew(
		links,
		{ mark: state.mark, keys: state.idsAtMark },
		(link) => link.createdAt,
		(link) => String(link.idString ?? link.id ?? ''),
	);
	return { fresh, next: withMark(next.mark, { idsAtMark: next.keys }) };
}

/** Raw clicks have no id; this composite key identifies one. */
export function clickKey(c: IDataObject): string {
	return `${String(c.dt ?? '')}|${String(c.ip ?? '')}|${String(c.path ?? '')}|${String(c.ua ?? '')}`;
}

/** Selects clicks newer than the saved mark (see {@link selectNew}), oldest first. */
export function selectNewClicks(
	clicks: IDataObject[],
	state: ClickState,
): { fresh: IDataObject[]; next: ClickState } {
	const { fresh, next } = selectNew(
		clicks,
		{ mark: state.mark, keys: state.keysAtMark },
		(c) => c.dt,
		clickKey,
	);
	return { fresh, next: withMark(next.mark, { keysAtMark: next.keys }) };
}
