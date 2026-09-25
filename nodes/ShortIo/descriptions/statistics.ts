import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IDisplayOptions, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { HAS_ZONE_RE, parseAndValidateNaiveDateTime, toIsoDate } from '../../../shared/fields';
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

function pad(n: number, len = 2): string {
	return String(n).padStart(len, '0');
}

/** Throws `Invalid timezone: <tz>` if `tz` isn't a name `Intl` recognizes as a valid IANA zone. */
function assertValidTz(tz: string): void {
	let valid = true;
	try {
		Intl.DateTimeFormat('en-US', { timeZone: tz });
	} catch {
		valid = false;
	}
	if (!valid) {
		throw new Error(`Invalid timezone: ${tz}`);
	}
}

/**
 * Whether date-time string `a` names a later instant than `b`. Compares parsed milliseconds, not
 * the strings themselves: a lexical comparison breaks on differing fractional-second width (e.g.
 * `'…T10:00:00Z' > '…T10:00:00.5Z'` is `true` as strings — wrong, since `.5` is later — because `Z`
 * sorts after `.`) and isn't meaningful across differing offset notations either. `toStatsWallClock`
 * output is always a wall-clock reading with a literal `Z`; `Date.parse` still gives a consistent
 * ordering for it because both sides are parsed the same (pseudo-UTC) way — the fictional zone
 * cancels out in a comparison between two values that both use it for the same real `tz`.
 */
export function isAfter(a: string, b: string): boolean {
	return Date.parse(a) > Date.parse(b);
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
 * `tz` at all (see `shared/fields.ts`'s `toInstant`, used there instead).
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
 * reading — its shape and calendar validity are checked and it's passed through with a literal `Z`
 * appended, no conversion needed (though `tz` is still validated up front, since this branch alone
 * has nothing else that would reject an invalid one). Anything else (an explicit `Z`/offset string,
 * a `Date`, an epoch number, or a Luxon-like `.toISO()` value) names a real, unambiguous instant;
 * that instant is converted to its wall-clock reading *in* `tz` (via `Intl.DateTimeFormat` — an
 * instant has exactly one wall-clock reading in a zone, so no DST-transition disambiguation is
 * needed in this direction, unlike the reverse) and returned the same way. `''`/`null`/`undefined`
 * become `undefined`. Throws on unparseable/impossible input or an invalid `tz`.
 */
export function toStatsWallClock(v: unknown, tz: string): string | undefined {
	assertValidTz(tz);

	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return undefined;

		if (!HAS_ZONE_RE.test(trimmed)) {
			const parts = parseAndValidateNaiveDateTime(trimmed);
			return `${pad(parts.y, 4)}-${pad(parts.mo)}-${pad(parts.d)}T${pad(parts.h)}:${pad(parts.mi)}:${pad(parts.s)}${parts.frac}Z`;
		}
	}

	const instant = toIsoDate(v);
	if (instant === undefined) return undefined;
	return formatWallClockInTz(instant, tz);
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
		if (isAfter(dtStart, dtEnd)) {
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
 * {@link toStatsWallClock}. A bare `YYYY-MM-DD` date is accepted, but the API treats a bare end
 * date as midnight at the start of that day, excluding the whole day — use a full date-time for
 * End Date. A start date after the end date is rejected before any HTTP call.
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
	if (isAfter(startDate, endDate)) {
		throw new NodeOperationError(fn.getNode(), `Start Date (${startDate}) must not be after End Date (${endDate})`, {
			itemIndex: i,
		});
	}
	return { period, startDate, endDate };
}

/**
 * Reads `timezone` for item `i`, falling back to the workflow timezone when empty.
 * Throws if the resolved IANA name is invalid, so a bad tz never reaches the API.
 */
export function buildTimezone(fn: IExecuteFunctions, i: number): string {
	const tz = String(fn.getNodeParameter('timezone', i, '') ?? '').trim();
	const resolved = tz || fn.getTimezone();
	assertValidTz(resolved);
	return resolved;
}
