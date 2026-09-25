import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions, INodeParameterResourceLocator } from 'n8n-workflow';

import { shortIoRequest, type ShortIoContext, type ShortIoRequest } from './transport';

/** Accepts both the legacy `lnk_…` prefix and the current `link_…` prefix. */
export const LINK_ID_REGEX = '^(lnk|link)_[A-Za-z0-9_]+$';
const LINK_ID_RE = new RegExp(LINK_ID_REGEX);

export interface DomainInfo {
	id: number;
	hostname: string;
}

/** `shortIoRequest.call(ctx, req)` loses its generic `T` (defaults to `unknown`); this restores it. */
async function typedRequest<T>(ctx: ShortIoContext, req: ShortIoRequest): Promise<T> {
	return (await shortIoRequest.call(ctx, req)) as T;
}

/**
 * Caches `GET /domains/{id}` lookups by id for the lifetime of one node execution. A rejected
 * lookup is evicted immediately so a transient failure isn't replayed to every later item that
 * asks for the same domain id.
 */
export class DomainCache {
	private cache = new Map<number, Promise<DomainInfo>>();

	get(ctx: ShortIoContext, id: number): Promise<DomainInfo> {
		let entry = this.cache.get(id);
		if (!entry) {
			entry = typedRequest<DomainInfo>(ctx, {
				method: 'GET',
				path: `/domains/${id}`,
				resource: 'domain',
			});
			this.cache.set(id, entry);
			entry.catch(() => {
				if (this.cache.get(id) === entry) {
					this.cache.delete(id);
				}
			});
		}
		return entry;
	}
}

/** Normalizes a resourceLocator parameter (or a plain string) to its trimmed string value. */
export function locatorValue(param: unknown): string {
	if (param !== null && typeof param === 'object' && '__rl' in (param as object)) {
		return String((param as INodeParameterResourceLocator).value ?? '').trim();
	}
	return String(param ?? '').trim();
}

/**
 * Validates that `value` is a positive integer string and returns it as a `number`.
 *
 * Without `itemIndex` the failure throws a generic `Error` naming `label`: used outside item
 * execution (e.g. by {@link resolveDomainId}, which listSearch methods call with no per-item
 * context). With `itemIndex`, the failure throws a `NodeOperationError` naming the offending
 * value, bound to the calling `IExecuteFunctions` via `.call`.
 */
export function resolvePositiveInt(
	this: IExecuteFunctions | void,
	value: string,
	label: string,
	itemIndex?: number,
): number {
	if (/^[1-9][0-9]*$/.test(value)) {
		return Number(value);
	}
	if (itemIndex !== undefined) {
		throw new NodeOperationError(
			(this as IExecuteFunctions).getNode(),
			`"${value}" is not a valid ${label}`,
			{ itemIndex },
		);
	}
	throw new Error(`${label} must be a positive integer`);
}

/** Parses and validates a domain id from either a resourceLocator value or a plain string/number. */
export function resolveDomainId(param: unknown): number {
	return resolvePositiveInt(locatorValue(param), 'Domain ID');
}

/**
 * Parses a full or scheme-less short URL into its hostname and path (no leading slash, no
 * trailing slash, no query string or fragment). Prepends `https://` when there is no scheme.
 *
 * `URL.pathname` percent-encodes non-ASCII characters and spaces; that encoding is undone here
 * so the path isn't double-encoded when it's later sent as a `qs` value (the HTTP client encodes
 * query values itself). A malformed percent-encoded sequence is left as-is rather than rejected.
 * The hostname is left in its punycode (ASCII) form, which is what the Domain `hostname` field
 * (and thus domain-locator matching) uses.
 */
export function parseShortUrl(input: string): { hostname: string; path: string } {
	const trimmed = input.trim();
	const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

	if (!URL.canParse(withScheme)) {
		throw new Error(`"${input}" is not a valid short URL`);
	}
	const url = new URL(withScheme);

	const rawPath = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
	if (!rawPath) {
		throw new Error(`"${input}" is missing a path`);
	}

	let path = rawPath;
	try {
		path = decodeURIComponent(rawPath);
	} catch {
		// Malformed percent-encoding: keep the raw (still percent-encoded) path.
	}

	return { hostname: url.hostname.toLowerCase(), path };
}

/**
 * Resolves a Link resourceLocator to its `lnk_…`/`link_…` idString.
 * Mode `id`: validates the id locally, no HTTP call.
 * Mode `url`: resolves the short URL via `GET /links/expand`.
 */
export async function resolveLinkId(
	this: IExecuteFunctions,
	param: unknown,
	i: number,
): Promise<string> {
	const mode =
		param !== null && typeof param === 'object' && '__rl' in (param as object)
			? (param as INodeParameterResourceLocator).mode
			: 'id';
	const value = locatorValue(param);

	if (mode === 'url') {
		const { hostname, path } = parseShortUrl(value);
		const link = await typedRequest<{ idString: string }>(this, {
			method: 'GET',
			path: '/links/expand',
			qs: { domain: hostname, path },
			resource: 'link',
			itemIndex: i,
		});
		return link.idString;
	}

	if (!LINK_ID_RE.test(value)) {
		throw new NodeOperationError(this.getNode(), `"${value}" is not a valid link ID`, {
			itemIndex: i,
		});
	}
	return value;
}

const FOLDER_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Resolves a Folder resourceLocator (or plain string) to its folder id and validates it before
 * it's interpolated into a request path. Rejects anything else (including a
 * path-traversal-shaped expression value) with a `NodeOperationError`. The caller is still
 * responsible for `encodeURIComponent`-ing the result when building the path.
 */
export function resolveFolderId(this: IExecuteFunctions, param: unknown, i: number): string {
	const raw = locatorValue(param);
	if (!raw || !FOLDER_ID_RE.test(raw)) {
		throw new NodeOperationError(this.getNode(), `"${raw}" is not a valid folder ID`, {
			itemIndex: i,
		});
	}
	return raw;
}

const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
/** ISO 3166-2 subdivision codes seen from the API are 1-3 alphanumerics (the live probe returns e.g. `CA`). */
const REGION_CODE_RE = /^[A-Za-z0-9]{1,3}$/;

/**
 * Upper-cases and validates an ISO 3166-1 alpha-2 country code before it's interpolated into a
 * request path or body. Rejects anything else (including a path-traversal-shaped expression
 * value) with a `NodeOperationError`.
 */
export function resolveCountryCode(this: IExecuteFunctions, value: unknown, i: number): string {
	const raw = String(value ?? '').trim().toUpperCase();
	if (!COUNTRY_CODE_RE.test(raw)) {
		throw new NodeOperationError(this.getNode(), `"${String(value)}" is not a valid country code`, {
			itemIndex: i,
		});
	}
	return raw;
}

/**
 * Validates an ISO 3166-2 subdivision (region) code before it's interpolated into a request path
 * or body. Rejects anything else (including a path-traversal-shaped expression value) with a
 * `NodeOperationError`.
 */
export function resolveRegionCode(this: IExecuteFunctions, value: unknown, i: number): string {
	const raw = String(value ?? '').trim();
	if (!REGION_CODE_RE.test(raw)) {
		throw new NodeOperationError(this.getNode(), `"${raw}" is not a valid region code`, {
			itemIndex: i,
		});
	}
	return raw;
}
