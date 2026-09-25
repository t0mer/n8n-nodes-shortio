import { NodeApiError, sleep } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';

export const HOSTS = {
	api: 'https://api.short.io',
	statistics: 'https://statistics.short.io/statistics',
} as const;

export type ShortIoHost = keyof typeof HOSTS;

export type ShortIoContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export interface ShortIoRequest {
	method: IHttpRequestMethods;
	host?: ShortIoHost;
	path: string;
	qs?: IDataObject;
	body?: IDataObject | unknown[];
	binary?: boolean;
	headers?: IDataObject;
	resource?: string;
	itemIndex?: number;
}

export const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export function retryDelayMs(attempt: number, retryAfter: string | undefined): number {
	const seconds = retryAfter !== undefined ? Number(retryAfter) : NaN;
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
	}
	return 1000 * 2 ** (attempt - 1);
}

export function getHeader(
	headers: Record<string, string> | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	if (headers[name] !== undefined) return headers[name];
	const lower = name.toLowerCase();
	return Object.entries(headers).find(([k]) => k.toLowerCase() === lower)?.[1];
}

/**
 * Binary-mode responses are always requested with `encoding: 'arraybuffer'`, so an error response
 * (status >= 400) arrives as raw bytes too, even though the API's error bodies are JSON. Decodes
 * those bytes as UTF-8 and parses them as JSON when possible, so {@link toShortIoError} can still
 * read the API's `error`/`message` field; falls back to the decoded string when it isn't JSON.
 */
function decodeBinaryErrorBody(body: unknown): unknown {
	if (!Buffer.isBuffer(body) && !(body instanceof ArrayBuffer)) return body;
	const text = Buffer.from(body as ArrayBuffer).toString('utf8');
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * Fastify validation error bodies (`{"code":"FST_ERR_VALIDATION","error":"Bad Request","message":
 * "links/0/originalURL must pass \"url\" keyword validation"}`) put the useful detail in `message`
 * and a generic HTTP reason phrase in `error`, so `message` is preferred when present. Other
 * Short.io errors (`{"error":"Link already exists"}`, `{"error":"Link not found"}`, 402 plan
 * errors, …) carry only `error`, so those are unaffected.
 */
function apiMessage(body: unknown): string | undefined {
	if (body && typeof body === 'object') {
		const record = body as IDataObject;
		for (const key of ['message', 'error']) {
			const value = record[key];
			if (typeof value === 'string' && value) return value;
		}
		return undefined;
	}
	return typeof body === 'string' && body ? body : undefined;
}

export function toShortIoError(
	node: INode,
	statusCode: number,
	body: unknown,
	req: ShortIoRequest,
): NodeApiError {
	const apiMsg = apiMessage(body) ?? `HTTP ${statusCode}`;
	const resourceName = req.resource ?? 'resource';
	let message = `Short.io error: ${apiMsg}`;
	let description: string | undefined;

	if (statusCode === 401 || statusCode === 403) {
		description = 'Check your API key and its domain permissions.';
	} else if (statusCode === 404) {
		message = `The ${resourceName} was not found (${apiMsg})`;
	} else if (statusCode === 409) {
		description =
			'The requested path is already used by another link on this domain. Choose a different path, or omit it to let Short.io generate one.';
	} else if (statusCode === 429) {
		message = `Short.io rate limit exceeded after ${MAX_ATTEMPTS} attempts (${apiMsg})`;
	}

	const errorBody: JsonObject =
		body && typeof body === 'object' ? (body as JsonObject) : ({ message: apiMsg } as JsonObject);

	return new NodeApiError(node, errorBody, {
		message,
		description,
		httpCode: String(statusCode),
		itemIndex: req.itemIndex,
	});
}

export async function shortIoRequest<T = unknown>(
	this: ShortIoContext,
	req: ShortIoRequest,
): Promise<T> {
	const options: IHttpRequestOptions = {
		method: req.method,
		url: `${HOSTS[req.host ?? 'api']}${req.path}`,
		json: !req.binary,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		...(req.qs !== undefined ? { qs: req.qs } : {}),
		...(req.body !== undefined ? { body: req.body } : {}),
		...(req.binary ? { encoding: 'arraybuffer' as const } : {}),
		...(req.headers !== undefined ? { headers: req.headers as Record<string, string> } : {}),
	};

	for (let attempt = 1; ; attempt++) {
		const res = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'shortIoApi',
			options,
		)) as { statusCode: number; headers: Record<string, string>; body: unknown };

		if (res.statusCode === 429 && attempt < MAX_ATTEMPTS) {
			const retryAfter = getHeader(res.headers, 'retry-after');
			await sleep(retryDelayMs(attempt, retryAfter));
			continue;
		}

		if (res.statusCode >= 400) {
			const errorBody = req.binary ? decodeBinaryErrorBody(res.body) : res.body;
			throw toShortIoError(this.getNode(), res.statusCode, errorBody, req);
		}

		if (req.binary) {
			const contentType = getHeader(res.headers, 'content-type');
			return { data: Buffer.from(res.body as ArrayBuffer), contentType } as T;
		}

		const bodyObj = res.body as IDataObject | undefined;
		if (bodyObj && typeof bodyObj === 'object' && !Array.isArray(bodyObj) && bodyObj.success === false) {
			throw toShortIoError(this.getNode(), res.statusCode, bodyObj, req);
		}

		return res.body as T;
	}
}
