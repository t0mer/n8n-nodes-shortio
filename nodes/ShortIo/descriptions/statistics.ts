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

/** Loosely parses `YYYY-MM-DD[THH:mm[:ss]]` (a space is also accepted for the separator),
 * defaulting a missing time to midnight. `undefined` when the shape doesn't match at all. */
function parseNaiveDateTime(
	v: string,
): { y: number; mo: number; d: number; h: number; mi: number; s: number } | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
	if (!m) return undefined;
	return {
		y: Number(m[1]),
		mo: Number(m[2]),
		d: Number(m[3]),
		h: Number(m[4] ?? '0'),
		mi: Number(m[5] ?? '0'),
		s: Number(m[6] ?? '0'),
	};
}

/**
 * Resolves the UTC offset (`+hh:mm`/`-hh:mm`) an IANA zone has at a given instant. Luxon (the
 * usual tool for this) ships no TypeScript type declarations reachable from this project — despite
 * being a transitive dependency of `n8n-workflow`, `tsc` fails with "Cannot find module 'luxon' or
 * its corresponding type declarations" — so this uses `Intl.DateTimeFormat`'s `longOffset` zone
 * name instead, which every supported Node version provides. `atMs` only has to land within the
 * right side of a DST transition to resolve the correct offset, not be the exact final instant, so
 * using a first-pass UTC interpretation of the naive local time as `atMs` is accurate enough.
 */
function tzOffsetAt(tz: string, atMs: number): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		timeZoneName: 'longOffset',
	}).formatToParts(new Date(atMs));
	const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
	return /^GMT([+-]\d{2}:\d{2})?$/.exec(raw)?.[1] ?? '+00:00';
}

function pad(n: number, len = 2): string {
	return String(n).padStart(len, '0');
}

/**
 * Normalizes a date-ish value for the statistics API's date/time fields (`startDate`/`endDate`,
 * the `dt` filter range, and Get Link Clicks' `startDate`/`endDate`/`createdAt`) against `tz` (the
 * node's own resolved Timezone parameter — or `this.getTimezone()` for Get Link Clicks, which has
 * no Timezone parameter of its own). The live API returns 400 for a zone-less date-time outright;
 * it only accepts a bare date or a full date-time carrying `Z` or a `±hh:mm` offset. So a zone-less
 * string (no trailing `Z`/offset — the shape n8n's dateTime picker emits for a value typed without
 * a timezone) is interpreted in `tz`, not in whatever zone the n8n host process happens to run in
 * (which is what `toIsoDate`'s plain `new Date(...)` conversion would otherwise silently apply),
 * and sent with that zone's own offset attached. A string that already carries an explicit zone is
 * sent unchanged, preserving its given offset as-is. A `Date`, an epoch number, or a Luxon-like
 * value exposing `.toISO()` all go through `toIsoDate` as before. `''`/`null`/`undefined` become
 * `undefined`, same as `toIsoDate`.
 */
export function toStatsDateTime(v: unknown, tz: string): string | undefined {
	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return undefined;

		if (HAS_ZONE_RE.test(trimmed)) {
			if (Number.isNaN(Date.parse(trimmed))) {
				throw new Error(`Invalid date: ${v}`);
			}
			return trimmed;
		}

		const parts = parseNaiveDateTime(trimmed);
		if (!parts || Number.isNaN(Date.parse(trimmed))) {
			throw new Error(`Invalid date: ${v}`);
		}
		const utcGuess = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s);
		const offset = tzOffsetAt(tz, utcGuess);
		return `${pad(parts.y, 4)}-${pad(parts.mo)}-${pad(parts.d)}T${pad(parts.h)}:${pad(parts.mi)}:${pad(parts.s)}${offset}`;
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

	const dtStart = toStatsDateTime(columns.dtStart, tz);
	const dtEnd = toStatsDateTime(columns.dtEnd, tz);
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
 * {@link toStatsDateTime} (a bare `YYYY-MM-DD` date is rejected by neither helper, but the API
 * treats a bare end date as midnight at the start of that day, excluding the whole day — use a
 * full date-time). A start date after the end date is rejected before any HTTP call.
 */
export function buildPeriod(fn: IExecuteFunctions, i: number, tz: string): PeriodFields {
	const period = fn.getNodeParameter('period', i, 'last30') as string;
	if (period !== 'custom') return { period };

	const startDate = toStatsDateTime(fn.getNodeParameter('startDate', i, ''), tz);
	const endDate = toStatsDateTime(fn.getNodeParameter('endDate', i, ''), tz);
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
