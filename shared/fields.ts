import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeParameterResourceLocator } from 'n8n-workflow';

import { locatorValue } from './locators';

/** The three Link fields that accept either an ISO date-time string or an epoch-ms number. */
export const LINK_DATE_FIELDS = ['expiresAt', 'ttl', 'createdAt'] as const;

function isResourceLocator(v: unknown): v is INodeParameterResourceLocator {
	return v !== null && typeof v === 'object' && '__rl' in (v as object);
}

interface HasToISO {
	toISO: () => string | null;
}

function hasToISO(v: unknown): v is HasToISO {
	return v !== null && typeof v === 'object' && typeof (v as HasToISO).toISO === 'function';
}

/** Below this magnitude a millisecond epoch would land before ~1973: almost certainly seconds. */
const MIN_PLAUSIBLE_EPOCH_MS = 1e11;

function dateFromEpochOrIso(raw: string | number, original: unknown): Date {
	const asNumber = typeof raw === 'number' ? raw : Number(raw);
	const looksLikeEpoch = typeof raw === 'number' || /^-?\d+$/.test(raw.trim());
	if (looksLikeEpoch && Math.abs(asNumber) < MIN_PLAUSIBLE_EPOCH_MS) {
		throw new Error(
			`Invalid date: ${String(original)} looks like epoch seconds; use milliseconds or an ISO date`,
		);
	}
	const date = looksLikeEpoch ? new Date(asNumber) : new Date(raw);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid date: ${String(original)}`);
	}
	return date;
}

/**
 * Normalizes a date-ish value to an ISO 8601 string. Accepts a `Date`, an ISO string, an epoch-ms
 * number or numeric string, or an n8n-style `DateTime` (any object exposing `toISO()`).
 * `''`/`null`/`undefined` become `undefined` (field omitted); anything unparseable throws.
 */
export function toIsoDate(v: unknown): string | undefined {
	if (v === undefined || v === null || v === '') return undefined;

	if (v instanceof Date) {
		if (Number.isNaN(v.getTime())) throw new Error(`Invalid date: ${String(v)}`);
		return v.toISOString();
	}

	if (hasToISO(v)) {
		const iso = v.toISO();
		if (!iso) throw new Error(`Invalid date: ${String(v)}`);
		return iso;
	}

	if (typeof v === 'number') {
		return dateFromEpochOrIso(v, v).toISOString();
	}

	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return undefined;
		return dateFromEpochOrIso(trimmed, v).toISOString();
	}

	throw new Error(`Invalid date: ${String(v)}`);
}

/**
 * Matches the *naive* `YYYY-MM-DD[THH:mm[:ss[.fraction]]]` shape (a space is also accepted for the
 * `T`/space separator) with no trailing zone marker of any kind. This is the single, narrow test
 * that decides whether a string is treated as wall-clock-in-`tz` (by {@link toInstant} and
 * `toStatsWallClock`) rather than a real, already-resolved value delegated to {@link toIsoDate} —
 * deliberately a positive match against this exact shape, not a negative "doesn't look zoned"
 * guess: an earlier version tested only for the *absence* of a trailing `Z`/offset, which wrongly
 * routed epoch-ms numeric strings (`'1758801600000'`), non-ISO formats (RFC 2822), and hour-only
 * offsets (`'...+03'`, missing minutes) into the naive-parse path too, where they threw instead of
 * falling through to `toIsoDate` as they always used to. Exported so `toStatsWallClock` (which has
 * its own zone-less/real-instant split for the same reason, but for the opposite instant↔wall-clock
 * direction) uses the exact same test, not a re-derived one.
 */
export const NAIVE_DATETIME_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/;

/** Loosely parses `YYYY-MM-DD[THH:mm[:ss[.fraction]]]` (a space is also accepted for the
 * separator), defaulting a missing time to midnight. `frac` is the fractional-seconds part
 * including its leading `.`, truncated to at most 3 digits (millisecond precision, matching every
 * other timestamp this node sends), e.g. `.123456` becomes `.123`; `''` when absent. `undefined`
 * when the shape doesn't match at all — this only checks the *shape*; an impossible calendar value
 * (e.g. February 30) still parses here and is caught by {@link parseAndValidateNaiveDateTime}. */
function parseNaiveDateTime(v: string): {
	y: number;
	mo: number;
	d: number;
	h: number;
	mi: number;
	s: number;
	frac: string;
} | undefined {
	const m = NAIVE_DATETIME_RE.exec(v);
	if (!m) return undefined;
	return {
		y: Number(m[1]),
		mo: Number(m[2]),
		d: Number(m[3]),
		h: Number(m[4] ?? '0'),
		mi: Number(m[5] ?? '0'),
		s: Number(m[6] ?? '0'),
		frac: m[7] ? m[7].slice(0, 4) : '', // '.' + up to 3 digits
	};
}

/**
 * Parses and fully validates a naive date-time string, throwing `Invalid date: <v>` when it either
 * doesn't match the expected shape ({@link parseNaiveDateTime} returns `undefined`) or names a
 * calendar date/time that doesn't exist (e.g. `2026-02-30T00:00:00`). `Date.UTC` alone can't be
 * trusted to reject the latter — it silently normalizes an out-of-range day/month/hour/etc. instead
 * of failing (`Date.UTC(2026, 1, 30)`, February 30, quietly becomes March 2) — so this round-trips
 * the parsed fields through it and rejects the input if the result doesn't land back on the exact
 * same year/month/day/hour/minute/second.
 */
export function parseAndValidateNaiveDateTime(v: string): {
	y: number;
	mo: number;
	d: number;
	h: number;
	mi: number;
	s: number;
	frac: string;
} {
	const parts = parseNaiveDateTime(v);
	if (!parts) {
		throw new Error(`Invalid date: ${v}`);
	}
	const check = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s));
	const roundTrips =
		check.getUTCFullYear() === parts.y &&
		check.getUTCMonth() === parts.mo - 1 &&
		check.getUTCDate() === parts.d &&
		check.getUTCHours() === parts.h &&
		check.getUTCMinutes() === parts.mi &&
		check.getUTCSeconds() === parts.s;
	if (!roundTrips) {
		throw new Error(`Invalid date: ${v}`);
	}
	return parts;
}

/** A full day in milliseconds: comfortably more than any single DST transition's jump, so sampling
 * an IANA zone's offset this far before and after a naive instant reliably lands outside the
 * transition itself on each side (used by {@link resolveOffsetMinutes}). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolves the UTC offset (in minutes east of UTC) an IANA zone has at a given real UTC instant
 * (`atMs`), via `Intl.DateTimeFormat`'s `longOffset` zone name. Luxon (the usual tool for this) has
 * no TypeScript type declarations reachable from this project — despite being a transitive
 * dependency of `n8n-workflow`, `tsc` fails with "Cannot find module 'luxon' or its corresponding
 * type declarations" — so this is the fallback, and every supported Node version provides it. */
function tzOffsetMinutesAt(tz: string, atMs: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		timeZoneName: 'longOffset',
	}).formatToParts(new Date(atMs));
	const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
	const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(raw);
	if (!m) return 0;
	return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Resolves the UTC offset (in minutes) to subtract from a *naive local wall-clock* time (`naiveMs`:
 * the date/time fields reinterpreted as if they were themselves a UTC instant — what
 * `Date.UTC(y, mo, d, h, mi, s)` on the parsed fields gives) to get the real instant it names in an
 * IANA zone. Used only by {@link toInstant}.
 *
 * A single naive-as-UTC lookup (`tzOffsetMinutesAt(tz, naiveMs)`) picks the wrong offset for the
 * entire window before a spring-forward gap: e.g. Asia/Jerusalem's `2026-03-27T01:30` resolves to
 * `+03:00` that way, but the correct answer is `+02:00` (the real instant is `2026-03-26T23:30Z`,
 * still standard time). So this samples the zone's offset a full day before and after `naiveMs`
 * first. If they're equal, there's no nearby transition and that's the answer. Otherwise, each
 * sampled offset gives a candidate real UTC instant (`naiveMs` shifted back by that offset); a
 * candidate is valid only if it round-trips — querying the zone's offset *at* that candidate
 * instant gives back the same offset used to compute it:
 * - **Both** candidates round-trip: the local time is ambiguous (a repeated hour during fall-back).
 *   Resolves to the **earlier** of the two real instants — the first occurrence — chosen
 *   consistently regardless of the zone's offset sign.
 * - **Neither** round-trips: the local time doesn't exist (a skipped hour during a spring-forward
 *   gap). A gap only ever occurs when the offset *increases* at the transition (clocks spring
 *   forward), so `before` (the smaller, pre-transition offset) is subtracted the least, landing the
 *   resulting instant *past* the transition — which reads back, in the post-transition zone, as the
 *   requested local time shifted forward by exactly the gap's size (the "shift forward" convention
 *   most libraries use). Using `after` here instead (an earlier bug) would subtract too much and
 *   land the instant *before* the transition, reading back as the requested time shifted backward.
 * - **Exactly one** round-trips: that's the unambiguous answer.
 */
function resolveOffsetMinutes(tz: string, naiveMs: number): number {
	const before = tzOffsetMinutesAt(tz, naiveMs - DAY_MS);
	const after = tzOffsetMinutesAt(tz, naiveMs + DAY_MS);
	if (before === after) return before;

	const candidateBefore = naiveMs - before * 60_000;
	const validBefore = tzOffsetMinutesAt(tz, candidateBefore) === before;
	const candidateAfter = naiveMs - after * 60_000;
	const validAfter = tzOffsetMinutesAt(tz, candidateAfter) === after;

	if (validBefore && validAfter) return candidateBefore <= candidateAfter ? before : after;
	if (validBefore) return before;
	if (validAfter) return after;
	return before; // Gap: neither exists; `before` shifts the result forward past the transition.
}

/**
 * Normalizes a date-ish value to a true ISO UTC instant. Only a string matching
 * {@link NAIVE_DATETIME_RE} (the exact naive `YYYY-MM-DD[THH:mm[:ss[.fff]]]` shape, no zone) is
 * treated as wall-clock time in `tz` and converted to the true instant via
 * {@link resolveOffsetMinutes}, correct across DST transitions. **Everything else** — a `Z`/offset
 * string in any form, an epoch-ms/seconds numeric string, an RFC 2822 or other non-ISO string, a
 * `Date`, a raw epoch number, or a Luxon-like `.toISO()` value — delegates to {@link toIsoDate}
 * unchanged, exactly as it always did (including its seconds-scale-epoch and invalid-date
 * rejections). `''`/`null`/`undefined` become `undefined`.
 *
 * Regression this guards against: an earlier version routed into the naive-parse path on the
 * mere *absence* of a trailing `Z`/offset rather than a positive match on the naive shape, so a
 * numeric epoch-ms string like `'1758801600000'` (no zone suffix, but not naive-ISO either) was
 * wrongly sent through `parseAndValidateNaiveDateTime` and rejected as an "Invalid date" — breaking
 * every caller that maps an upstream epoch/RFC-2822/hour-only-offset value into a date field
 * through an expression.
 *
 * Host-timezone bug this function exists to fix in the first place: {@link toIsoDate} alone parses
 * a zone-less string with `new Date(raw)`, which JS interprets in the **n8n host process's**
 * timezone (`TZ` env var / system default), not the workflow's configured timezone — verified: the
 * same zone-less string produces a different UTC instant depending on the host's `TZ`, regardless
 * of what the workflow (or the user) intended. `tz` should always be `this.getTimezone()` (or, for
 * the statistics resource, its already-resolved per-item override) — the workflow's own timezone —
 * never the host's.
 */
export function toInstant(v: unknown, tz: string): string | undefined {
	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return undefined;

		if (NAIVE_DATETIME_RE.test(trimmed)) {
			const parts = parseAndValidateNaiveDateTime(trimmed);
			const fracMs = parts.frac ? Math.round(Number(parts.frac) * 1000) : 0;
			const naiveMs = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s, fracMs);
			const offsetMinutes = resolveOffsetMinutes(tz, naiveMs);
			return new Date(naiveMs - offsetMinutes * 60_000).toISOString();
		}
	}
	return toIsoDate(v);
}

/**
 * Normalizes a Tags value to a trimmed, non-empty string array, or `undefined` when there is
 * nothing to send. Accepts a comma-separated string (from the UI's plain-text field) or an array
 * (from an expression that already returns one).
 */
export function normalizeTags(v: unknown): string[] | undefined {
	if (v === undefined || v === null) return undefined;

	let raw: unknown[];
	if (Array.isArray(v)) {
		raw = v;
	} else if (typeof v === 'string') {
		raw = v.split(',');
	} else {
		return undefined;
	}

	const tags = raw.map((t) => String(t).trim()).filter((t) => t.length > 0);
	return tags.length > 0 ? tags : undefined;
}

function isEmptyResourceLocator(v: unknown): boolean {
	return isResourceLocator(v) && locatorValue(v) === '';
}

/**
 * Drops keys whose value carries no information for the Short.io API: `undefined`, `null`, `''`,
 * `[]`, and an empty resource locator (`{__rl:true, value:''}`). Keeps every other value,
 * including `false` and `0`, since those are meaningful.
 */
export function compact(obj: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		if (isEmptyResourceLocator(value)) continue;
		result[key] = value;
	}
	return result;
}

/**
 * Builds a Short.io link request body from a Create/Update "additional fields" collection value:
 * normalizes the three date fields and Tags, converts `redirectType` to a number and `folderId`
 * to its plain id, strips the deprecated `id` field, then drops empty values via `compact`. `tz`
 * (the caller's `this.getTimezone()`) is used to interpret a zone-less date field as wall-clock
 * time in the workflow's timezone, via {@link toInstant} — not the n8n host process's own timezone.
 */
export function buildLinkBody(fields: IDataObject, tz: string): IDataObject {
	const result: IDataObject = { ...fields };
	delete result.id;

	for (const dateField of LINK_DATE_FIELDS) {
		if (dateField in result) {
			const iso = toInstant(result[dateField], tz);
			if (iso === undefined) {
				delete result[dateField];
			} else {
				result[dateField] = iso;
			}
		}
	}

	if ('tags' in result) {
		const tags = normalizeTags(result.tags);
		if (tags === undefined) {
			delete result.tags;
		} else {
			result.tags = tags;
		}
	}

	if (result.redirectType !== undefined && result.redirectType !== '') {
		result.redirectType = Number(result.redirectType);
	}

	if ('folderId' in result) {
		result.folderId = locatorValue(result.folderId);
	}

	return compact(result);
}

/**
 * Validates that `value` is a non-empty string (after trimming) and returns it, throwing
 * `NodeOperationError` otherwise. Used for the required "Original URL" field on the country/
 * region targeting Create and Create Many operations.
 */
export function requireOriginalUrl(this: IExecuteFunctions, value: unknown, i: number): string {
	const raw = String(value ?? '').trim();
	if (!raw) {
		throw new NodeOperationError(this.getNode(), 'Original URL is required', { itemIndex: i });
	}
	return raw;
}

/**
 * Unwraps a Short.io response: returns it as-is when it's a non-array object with at least one
 * key, otherwise a bare `{success: true}`. Several endpoints (undocumented response schema) fall
 * back to this same shape.
 */
export function unwrapOrSuccess(response: unknown): IDataObject {
	if (
		response !== null &&
		typeof response === 'object' &&
		!Array.isArray(response) &&
		Object.keys(response as object).length > 0
	) {
		return response as IDataObject;
	}
	return { success: true };
}
