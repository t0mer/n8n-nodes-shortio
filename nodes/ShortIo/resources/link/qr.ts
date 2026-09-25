import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { BULK_LIMITS, forEachChunk } from '../../../../shared/bulk';
import { collect, errorItem, flatten, newSlots, toItemError } from './bulk';
import { compact } from '../../../../shared/fields';
import { resolveDomainId, resolveLinkId } from '../../../../shared/locators';
import { getHeader, shortIoRequest } from '../../../../shared/transport';
import type { BatchHandler } from '../../../../shared/types';

interface QrOptions {
	backgroundColor?: string;
	color?: string;
	size?: number;
	type?: 'png' | 'svg';
	useDomainSettings?: boolean;
}

interface QrManyOptions extends QrOptions {
	noExcavate?: boolean;
}

/** The `color`-type UI fields store `#RRGGBB`; the API wants the hex value without the `#`. */
function stripHash(hex: string | undefined): string | undefined {
	return hex?.replace(/^#/, '');
}

/** Resolves the binary MIME type and file extension for a QR image from its content-type header,
 * falling back to the requested image type when the header is absent (e.g. raw-bytes responses). */
function mimeAndExt(contentType: string | undefined, requestedType: string): { mime: string; ext: string } {
	const mime = contentType?.split(';')[0]?.trim() || (requestedType === 'svg' ? 'image/svg+xml' : 'image/png');
	const ext = mime.includes('svg') ? 'svg' : mime.includes('png') ? 'png' : requestedType;
	return { mime, ext };
}

/**
 * Resolves `POST /links/qr/{id}`'s response to image bytes. The endpoint normally returns
 * `{ url }`, which is downloaded (without credentials, and only over HTTPS, so the API key is
 * never sent to the third-party image host). If it ever returns raw bytes directly instead, those
 * are used as-is.
 */
async function resolveQrImage(
	this: IExecuteFunctions,
	response: unknown,
	i: number,
): Promise<{ buffer: Buffer; contentType?: string; url?: string }> {
	if (Buffer.isBuffer(response)) {
		return { buffer: response };
	}
	if (response instanceof ArrayBuffer) {
		return { buffer: Buffer.from(response) };
	}

	if (response && typeof response === 'object' && typeof (response as IDataObject).url === 'string') {
		const url = (response as { url: string }).url;

		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new NodeOperationError(this.getNode(), `The QR code URL is not valid: ${url}`, {
				itemIndex: i,
			});
		}
		if (parsed.protocol !== 'https:') {
			throw new NodeOperationError(
				this.getNode(),
				`Refusing to download the QR code image from a non-HTTPS URL: ${url}`,
				{ itemIndex: i },
			);
		}

		const download = (await this.helpers.httpRequest({
			method: 'GET',
			url,
			encoding: 'arraybuffer',
			returnFullResponse: true,
		})) as { body: ArrayBuffer; headers?: Record<string, string> };

		return {
			buffer: Buffer.from(download.body),
			contentType: getHeader(download.headers, 'content-type'),
			url,
		};
	}

	throw new NodeOperationError(this.getNode(), 'Unexpected response from the QR code endpoint', {
		itemIndex: i,
	});
}

/** Generate QR Code: `POST /links/qr/{id}`, downloads the resulting image, and returns it as binary. */
export async function generateQrCode(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
	const options = this.getNodeParameter('options', i, {}) as QrOptions;

	const id = await resolveLinkId.call(this, linkParam, i);
	const requestedType = options.type ?? 'png';

	const body: IDataObject = {
		...compact({
			backgroundColor: stripHash(options.backgroundColor),
			color: stripHash(options.color),
			size: options.size,
			type: options.type,
		}),
		useDomainSettings: options.useDomainSettings ?? true,
	};

	const response = await shortIoRequest.call(this, {
		method: 'POST',
		path: `/links/qr/${id}`,
		body,
		resource: 'link',
		itemIndex: i,
	});

	const { buffer, contentType, url } = await resolveQrImage.call(this, response, i);
	const { mime, ext } = mimeAndExt(contentType, requestedType);

	return [
		{
			json: { idString: id, ...(url ? { url } : {}), type: requestedType },
			binary: {
				[binaryPropertyName]: await this.helpers.prepareBinaryData(
					buffer,
					`qr-${id}.${ext}`,
					mime,
				),
			},
		},
	];
}

/**
 * Generate QR Codes (Many): chunks the input items' link ids at 150 per `POST /links/qr/bulk`
 * call. The domain and options are read once from item 0 (the endpoint accepts a single
 * `domainId` per call, so this operation applies one domain to every input item). Each successful
 * chunk yields one output item holding the response ZIP, with `pairedItem` set to every input
 * index in that chunk; a failed chunk falls back to the shared per-index continue-on-fail pattern.
 */
export const generateQrCodesMany: BatchHandler = async function (
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const slots = newSlots(items.length);

	let domainId: number;
	try {
		const domainParam = this.getNodeParameter('domain', 0);
		domainId = resolveDomainId(domainParam);
	} catch (error) {
		throw toItemError.call(this, error, 0);
	}

	const options = this.getNodeParameter('options', 0, {}) as QrManyOptions;
	const type = options.type ?? 'png';
	const useDomainSettings = options.useDomainSettings ?? true;
	const extraOptions = compact({
		backgroundColor: stripHash(options.backgroundColor),
		color: stripHash(options.color),
		size: options.size,
		noExcavate: options.noExcavate,
	});

	const entries = await collect(this, items.length, slots, async (i) => {
		const linkParam = this.getNodeParameter('link', i);
		return await resolveLinkId.call(this, linkParam, i);
	});

	const chunkItems: INodeExecutionData[] = [];

	await forEachChunk(entries, BULK_LIMITS.qrMany, async (part, chunkIndex) => {
		const indices = part.map((e) => e.index);
		let failure: Error | undefined;

		try {
			const { data, contentType } = (await shortIoRequest.call(this, {
				method: 'POST',
				path: '/links/qr/bulk',
				body: {
					linkIds: part.map((e) => e.value),
					domainId: String(domainId),
					type,
					useDomainSettings,
					...extraOptions,
				},
				resource: 'link',
				itemIndex: indices[0],
				binary: true,
			})) as { data: Buffer; contentType?: string };

			chunkItems.push({
				json: { linkIds: part.map((e) => e.value), count: part.length },
				binary: {
					data: await this.helpers.prepareBinaryData(
						data,
						`qr-codes-${chunkIndex + 1}.zip`,
						contentType ?? 'application/zip',
					),
				},
				pairedItem: indices.map((item) => ({ item })),
			});
		} catch (error) {
			if (this.continueOnFail()) {
				for (const index of indices) slots[index].push(errorItem(error, index));
				return;
			}
			failure = toItemError.call(this, error, indices[0]);
		}
		if (failure) throw failure;
	});

	return [...flatten(slots), ...chunkItems];
};
