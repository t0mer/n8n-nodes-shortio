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

/** Parses and validates a domain id from either a resourceLocator value or a plain string/number. */
export function resolveDomainId(param: unknown): number {
	const raw = locatorValue(param);
	if (!/^[1-9][0-9]*$/.test(raw)) {
		throw new Error('Domain ID must be a positive integer');
	}
	return Number(raw);
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
