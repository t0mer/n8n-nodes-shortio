import type { IDataObject, INodeParameterResourceLocator } from 'n8n-workflow';

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
 * to its plain id, strips the deprecated `id` field, then drops empty values via `compact`.
 */
export function buildLinkBody(fields: IDataObject): IDataObject {
	const result: IDataObject = { ...fields };
	delete result.id;

	for (const dateField of LINK_DATE_FIELDS) {
		if (dateField in result) {
			const iso = toIsoDate(result[dateField]);
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
