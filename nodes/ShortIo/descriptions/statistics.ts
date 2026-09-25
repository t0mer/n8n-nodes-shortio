import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IDisplayOptions, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { toIsoDate } from '../../../shared/fields';
import { COUNTRY_CODE_RE } from '../../../shared/locators';
import { COUNTRY_OPTIONS } from '../countries';

// The 9 `period` enum values (statistics digest §1), sorted alphabetically by display name.
export const PERIOD_OPTIONS = [
	{ name: 'All Time', value: 'total' },
	{ name: 'Custom', value: 'custom', description: 'Provide a start and end date' },
	{ name: 'Last 30 Days', value: 'last30' },
	{ name: 'Last 7 Days', value: 'last7' },
	{ name: 'Last Month', value: 'lastmonth' },
	{ name: 'This Month', value: 'month' },
	{ name: 'This Week', value: 'week' },
	{ name: 'Today', value: 'today' },
	{ name: 'Yesterday', value: 'yesterday' },
];

// `clicksChartInterval` / `interval` enum (statistics digest §1), sorted alphabetically.
export const INTERVAL_OPTIONS = [
	{ name: 'Day', value: 'day' },
	{ name: 'Hour', value: 'hour' },
	{ name: 'Month', value: 'month' },
	{ name: 'Week', value: 'week' },
];

// The 18 top-values `column` enum values (statistics digest §1), sorted alphabetically.
export const COLUMN_OPTIONS = [
	{ name: 'A/B Path', value: 'ab_path' },
	{ name: 'Browser', value: 'browser' },
	{ name: 'Browser Version', value: 'browser_version' },
	{ name: 'City', value: 'city' },
	{ name: 'Country', value: 'country' },
	{ name: 'Goal Completed', value: 'goal_completed' },
	{
		name: 'Human',
		value: 'human',
		description: 'Requires a Human filter (Include or Exclude); the API returns a 500 without one',
	},
	{ name: 'Method', value: 'method' },
	{ name: 'OS', value: 'os' },
	{ name: 'Path', value: 'path' },
	{ name: 'Path (404)', value: 'path_404' },
	{ name: 'Protocol', value: 'proto' },
	{ name: 'Referrer Host', value: 'refhost' },
	{ name: 'Social', value: 'social' },
	{ name: 'Status', value: 'st' },
	{ name: 'UTM Campaign', value: 'utm_campaign' },
	{ name: 'UTM Medium', value: 'utm_medium' },
	{ name: 'UTM Source', value: 'utm_source' },
];

function csvField(displayName: string, name: string, description: string): INodeProperties {
	return {
		displayName,
		name,
		type: 'string',
		default: '',
		description: `${description}. Comma-separated.`,
	};
}

// The 14 include/exclude filter columns (statistics digest §1 FILTER schema), sorted
// alphabetically by display name. `dt` is split into two dateTimes, joined into `[start, end]`.
const FILTER_COLUMNS: INodeProperties[] = [
	csvField('Browser Versions', 'browserVersions', 'Browser versions'),
	csvField('Browsers', 'browsers', 'Browsers, e.g. Chrome, Firefox'),
	{
		displayName: 'Countries',
		name: 'countries',
		type: 'multiOptions',
		options: COUNTRY_OPTIONS,
		default: [],
		description: 'Countries of the visitors',
	},
	{
		displayName: 'Date Range End',
		name: 'dtEnd',
		type: 'dateTime',
		default: '',
		description: 'End of the click date range. Requires Date Range Start.',
	},
	{
		displayName: 'Date Range Start',
		name: 'dtStart',
		type: 'dateTime',
		default: '',
		description: 'Start of the click date range. Requires Date Range End.',
	},
	{
		displayName: 'Human Only',
		name: 'human',
		type: 'boolean',
		default: true,
		description: 'Whether to match only clicks made by humans (not bots)',
	},
	csvField('Methods', 'methods', 'HTTP methods, e.g. GET, HEAD'),
	csvField('Paths', 'paths', 'Link paths, e.g. /abc123'),
	csvField('Protocols', 'protos', 'Protocols: http, https'),
	csvField('Referrer Hosts', 'refhosts', 'Referrer hosts, e.g. google.com'),
	csvField('Socials', 'socials', 'Social networks, e.g. facebook, twitter'),
	csvField('Statuses', 'statuses', 'HTTP status codes, e.g. 301, 404'),
	csvField('UTM Campaigns', 'utmCampaigns', 'UTM campaigns'),
	csvField('UTM Mediums', 'utmMediums', 'UTM mediums'),
	csvField('UTM Sources', 'utmSources', 'UTM sources'),
];

/** Period + custom start/end date properties shown for `show`. */
export function periodProperties(show: IDisplayOptions['show']): INodeProperties[] {
	return [
		{
			displayName: 'Period',
			name: 'period',
			type: 'options',
			options: PERIOD_OPTIONS,
			default: 'last30',
			description: 'The time interval to report on',
			displayOptions: { show },
		},
		{
			displayName: 'Start Date',
			name: 'startDate',
			type: 'dateTime',
			default: '',
			required: true,
			description: 'Only count clicks on or after this date. Inclusive date/time.',
			displayOptions: { show: { ...show, period: ['custom'] } },
		},
		{
			displayName: 'End Date',
			name: 'endDate',
			type: 'dateTime',
			default: '',
			required: true,
			description: 'Only count clicks on or before this date. Inclusive date/time.',
			displayOptions: { show: { ...show, period: ['custom'] } },
		},
	];
}

/** IANA timezone property; an empty value falls back to the workflow timezone at runtime. */
export function timezoneProperty(show: IDisplayOptions['show']): INodeProperties {
	return {
		displayName: 'Timezone',
		name: 'timezone',
		type: 'string',
		default: '',
		placeholder: 'Europe/Berlin',
		description:
			'IANA timezone name used to group clicks by day. Leave empty to use the workflow timezone.',
		displayOptions: { show },
	};
}

/** Include/exclude filters fixedCollection. */
export function filtersProperty(show: IDisplayOptions['show']): INodeProperties {
	return {
		displayName: 'Filters',
		name: 'filters',
		type: 'fixedCollection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Exclude',
				name: 'exclude',
				values: [
					{
						displayName: 'Columns',
						name: 'columns',
						type: 'collection',
						placeholder: 'Add Column',
						default: {},
						description: 'Exclude clicks matching any of these values',
						options: FILTER_COLUMNS,
					},
				],
			},
			{
				displayName: 'Include',
				name: 'include',
				values: [
					{
						displayName: 'Columns',
						name: 'columns',
						type: 'collection',
						placeholder: 'Add Column',
						default: {},
						description: 'Only count clicks matching these values',
						options: FILTER_COLUMNS,
					},
				],
			},
		],
	};
}

/** Matches a trailing UTC `Z` or a `±hh:mm`/`±hhmm` offset at the end of a date-time string. */
const HAS_ZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/;

/** Loosely parses `YYYY-MM-DD[THH:mm[:ss[.fraction]]]` (a space is also accepted for the
 * separator), defaulting a missing time to midnight. `frac` is the fractional-seconds part
 * including its leading `.` (e.g. `.123`), or `''` when absent — kept verbatim so it survives into
 * the formatted output. `undefined` when the shape doesn't match at all. */
function parseNaiveDateTime(v: string): {
	y: number;
	mo: number;
	d: number;
	h: number;
	mi: number;
	s: number;
	frac: string;
} | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/.exec(v);
	if (!m) return undefined;
	return {
		y: Number(m[1]),
		mo: Number(m[2]),
		d: Number(m[3]),
		h: Number(m[4] ?? '0'),
		mi: Number(m[5] ?? '0'),
		s: Number(m[6] ?? '0'),
		frac: m[7] ?? '',
	};
}

function pad(n: number, len = 2): string {
	return String(n).padStart(len, '0');
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
 * IANA zone. Used only by {@link toLinkClicksInstant} — every other statistics date goes through
 * {@link toStatsWallClock}, which needs no local-to-instant conversion at all.
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
 * Formats a real UTC instant (`isoInstant`, e.g. from `toIsoDate`) as the wall-clock reading it has
 * in `tz`, suffixed with a literal `Z` — not a true UTC marker; see {@link toStatsWallClock} for
 * why the statistics API wants it that way. Milliseconds come straight off the instant (they're the
 * same number regardless of which zone displays the instant, so no zone-aware lookup is needed for
 * them). Throws (a native `RangeError`) if `tz` isn't a valid IANA zone name.
 */
function formatWallClockInTz(isoInstant: string, tz: string): string {
	const date = new Date(isoInstant);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
	const ms = date.getUTCMilliseconds();
	const frac = ms > 0 ? `.${pad(ms, 3)}` : '';
	return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${frac}Z`;
}

/**
 * Normalizes a date-ish value for every statistics request that sends a `tz` parameter — Custom
 * period `startDate`/`endDate`, and the `dt` filter range. **Not** Get Link Clicks, which sends no
 * `tz` at all (see {@link toLinkClicksInstant}).
 *
 * Live API quirk this works around: whenever `tz` is present, the statistics API reads
 * `startDate`/`endDate`/`dt`'s clock digits as wall-clock time in `tz` and **discards any offset
 * marker the string itself carries** — it does not treat an already-offset value as a resolved
 * instant. Confirmed live: `startDate=2026-09-25T00:00:00+03:00&tz=Asia/Jerusalem` applies the
 * `+03:00` *and* is then shifted by `tz`'s own offset again, landing the query window 3h too early
 * and silently returning zero clicks (no error) instead of the real count. Sending the same
 * wall-clock reading as `2026-09-25T00:00:00Z` (i.e. the intended local digits, with the offset
 * marker stripped to a literal `Z`) with the same `tz` gives the correct result: `tz` supplies the
 * single shift the API actually applies, and the `Z` is just this API's required marker for "here
 * are the wall-clock digits", not a true UTC instant.
 *
 * So: a zone-less string (no trailing `Z`/offset) is already the intended wall-clock-in-`tz`
 * reading — it's validated and passed through with a literal `Z` appended, no conversion needed.
 * Anything else (an explicit `Z`/offset string, a `Date`, an epoch number, or a Luxon-like
 * `.toISO()` value) names a real, unambiguous instant; that instant is converted to its wall-clock
 * reading *in* `tz` (via `Intl.DateTimeFormat` — an instant has exactly one wall-clock reading in a
 * zone, so no DST-transition disambiguation is needed in this direction, unlike the reverse) and
 * returned the same way. `''`/`null`/`undefined` become `undefined`. Throws on unparseable input or
 * an invalid `tz`.
 */
export function toStatsWallClock(v: unknown, tz: string): string | undefined {
	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return undefined;

		if (!HAS_ZONE_RE.test(trimmed)) {
			const parts = parseNaiveDateTime(trimmed);
			if (!parts || Number.isNaN(Date.parse(trimmed))) {
				throw new Error(`Invalid date: ${v}`);
			}
			return `${pad(parts.y, 4)}-${pad(parts.mo)}-${pad(parts.d)}T${pad(parts.h)}:${pad(parts.mi)}:${pad(parts.s)}${parts.frac}Z`;
		}
	}

	const instant = toIsoDate(v);
	if (instant === undefined) return undefined;
	return formatWallClockInTz(instant, tz);
}

/**
 * Normalizes a date-ish value to a true ISO UTC instant, for Get Link Clicks only — the one
 * statistics operation that sends no `tz` parameter at all (confirmed absent from both its GET and
 * POST shapes; see `docs/api/digests/statistics.md` §4), so {@link toStatsWallClock}'s "send the
 * wall-clock digits with a literal Z" trick doesn't apply here: with no `tz` for the API to shift
 * by, an offset/`Z` string is honoured as the real instant it names, with no double-shift to work
 * around. A zone-less string is interpreted as wall-clock time in `tz` (the caller passes
 * `this.getTimezone()`, since this operation has no Timezone parameter of its own) and converted to
 * the true instant via {@link resolveOffsetMinutes}, correct across DST transitions. Anything else
 * goes through `toIsoDate` unchanged. `''`/`null`/`undefined` become `undefined`.
 */
export function toLinkClicksInstant(v: unknown, tz: string): string | undefined {
	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return undefined;

		if (!HAS_ZONE_RE.test(trimmed)) {
			const parts = parseNaiveDateTime(trimmed);
			if (!parts || Number.isNaN(Date.parse(trimmed))) {
				throw new Error(`Invalid date: ${v}`);
			}
			const fracMs = parts.frac ? Math.round(Number(parts.frac) * 1000) : 0;
			const naiveMs = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s, fracMs);
			const offsetMinutes = resolveOffsetMinutes(tz, naiveMs);
			return new Date(naiveMs - offsetMinutes * 60_000).toISOString();
		}
	}
	return toIsoDate(v);
}

function splitCsv(v: unknown): string[] {
	let raw: unknown[];
	if (Array.isArray(v)) raw = v;
	else if (typeof v === 'string') raw = v.split(',');
	else if (v === undefined || v === null) raw = [];
	else raw = [v];
	const values = raw.map((s) => String(s).trim()).filter((s) => s.length > 0);
	return [...new Set(values)];
}

const CSV_COLUMNS = [
	'browserVersions',
	'browsers',
	'methods',
	'paths',
	'protos',
	'refhosts',
	'socials',
	'utmCampaigns',
	'utmMediums',
	'utmSources',
] as const;

function buildFilterSet(columns: IDataObject, label: string, tz: string): IDataObject | undefined {
	const out: IDataObject = {};

	for (const key of CSV_COLUMNS) {
		const values = splitCsv(columns[key]);
		if (values.length > 0) out[key] = values;
	}

	const statuses = splitCsv(columns.statuses).map((s) => {
		const n = Number(s);
		if (!Number.isFinite(n)) {
			throw new Error(`${label} filter: "${s}" is not a valid HTTP status code`);
		}
		return n;
	});
	if (statuses.length > 0) out.statuses = statuses;

	const countries = splitCsv(columns.countries).map((c) => {
		const code = c.toUpperCase();
		if (!COUNTRY_CODE_RE.test(code)) {
			throw new Error(`${label} filter: "${c}" is not a valid country code`);
		}
		return code;
	});
	if (countries.length > 0) out.countries = [...new Set(countries)];

	const dtStart = toStatsWallClock(columns.dtStart, tz);
	const dtEnd = toStatsWallClock(columns.dtEnd, tz);
	if (dtStart !== undefined || dtEnd !== undefined) {
		if (dtStart === undefined || dtEnd === undefined) {
			throw new Error(`${label} filter: Date Range needs both a start and an end`);
		}
		if (dtStart > dtEnd) {
			throw new Error(`${label} filter: Date Range Start must not be after Date Range End`);
		}
		out.dt = [dtStart, dtEnd];
	}

	if (typeof columns.human === 'boolean') out.human = columns.human;

	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Converts the `filters` fixedCollection value into the API's `{include?, exclude?}` objects.
 * CSV columns are split and trimmed, statuses become numbers, countries are validated, and the
 * two Date Range fields become `dt: [start, end]`. Empty filter sets are dropped.
 */
export function buildStatsFilters(
	raw: unknown,
	tz: string,
): { include?: IDataObject; exclude?: IDataObject } {
	const result: { include?: IDataObject; exclude?: IDataObject } = {};
	if (raw === null || typeof raw !== 'object') return result;
	const value = raw as IDataObject;

	for (const kind of ['include', 'exclude'] as const) {
		const entry = value[kind] as IDataObject | undefined;
		const columns = (entry?.columns ?? {}) as IDataObject;
		const set = buildFilterSet(columns, kind === 'include' ? 'Include' : 'Exclude', tz);
		if (set) result[kind] = set;
	}
	return result;
}

export interface PeriodFields extends IDataObject {
	period: string;
	startDate?: string;
	endDate?: string;
}

/**
 * Reads `period` (and, for `custom`, the required `startDate`/`endDate`) for item `i`, via
 * {@link toStatsWallClock} (a bare `YYYY-MM-DD` date is rejected by neither helper, but the API
 * treats a bare end date as midnight at the start of that day, excluding the whole day — use a
 * full date-time). A start date after the end date is rejected before any HTTP call.
 */
export function buildPeriod(fn: IExecuteFunctions, i: number, tz: string): PeriodFields {
	const period = fn.getNodeParameter('period', i, 'last30') as string;
	if (period !== 'custom') return { period };

	const startDate = toStatsWallClock(fn.getNodeParameter('startDate', i, ''), tz);
	const endDate = toStatsWallClock(fn.getNodeParameter('endDate', i, ''), tz);
	if (startDate === undefined || endDate === undefined) {
		throw new NodeOperationError(fn.getNode(), 'Start Date and End Date are required when Period is Custom', {
			itemIndex: i,
		});
	}
	if (startDate > endDate) {
		throw new NodeOperationError(fn.getNode(), `Start Date (${startDate}) must not be after End Date (${endDate})`, {
			itemIndex: i,
		});
	}
	return { period, startDate, endDate };
}

/** Reads `timezone` for item `i`, falling back to the workflow timezone when empty. */
export function buildTimezone(fn: IExecuteFunctions, i: number): string {
	const tz = String(fn.getNodeParameter('timezone', i, '') ?? '').trim();
	return tz || fn.getTimezone();
}
