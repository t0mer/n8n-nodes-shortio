import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { BULK_LIMITS, forEachChunk } from '../../../../shared/bulk';
import { collect, errorItem, flatten, newSlots, toItemError } from './bulk';
import { compact } from '../../../../shared/fields';
import { resolveDomainId, resolveLinkId } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { BatchHandler } from '../../../../shared/types';

/** Requests the raw image bytes instead of Short.io's default `{url}` JSON response, which points
 * at a per-link CDN object that stays stale across regenerations with a different type/options. */
const ACCEPT_RAW_IMAGE: IDataObject = { Accept: '*/*' };

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

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Sanity-checks the requested image type against the response bytes' magic number, so a stale or
 * mismatched response is still labeled correctly: PNG starts with the `\x89PNG` signature, SVG is
 * XML text containing `<svg` (an XML prolog may precede it). Falls back to the requested type when
 * neither signature is recognized (can't tell, so trust the request).
 */
function resolveImageType(data: Buffer, requestedType: 'png' | 'svg'): { type: 'png' | 'svg'; mime: string; ext: string } {
	let detected: 'png' | 'svg' | undefined;
	if (data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
		detected = 'png';
	} else if (data.toString('utf8', 0, Math.min(data.length, 512)).includes('<svg')) {
		detected = 'svg';
	}

	const type = detected ?? requestedType;
	return { type, mime: type === 'svg' ? 'image/svg+xml' : 'image/png', ext: type };
}

/** Generate QR Code: `POST /links/qr/{id}` with a wildcard Accept header, returning the response's
 * raw image bytes directly as binary data. Short.io's default JSON-Accept response is a `{url}`
 * pointing at a CDN object cached per link (not per type/options), so a regenerated QR with a
 * different type or options comes back stale; requesting the raw bytes avoids that and needs no
 * third-party download. */
export async function generateQrCode(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const binaryPropertyName = (this.getNodeParameter('binaryPropertyName', i, 'data') as string).trim();
	const options = this.getNodeParameter('options', i, {}) as QrOptions;

	if (!binaryPropertyName) {
		throw new NodeOperationError(this.getNode(), 'Binary Property must not be empty', {
			itemIndex: i,
		});
	}

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

	const { data } = (await shortIoRequest.call(this, {
		method: 'POST',
		path: `/links/qr/${id}`,
		body,
		resource: 'link',
		itemIndex: i,
		binary: true,
		headers: ACCEPT_RAW_IMAGE,
	})) as { data: Buffer };

	const { type, mime, ext } = resolveImageType(data, requestedType);

	return [
		{
			json: { idString: id, type, requestedType },
			binary: {
				[binaryPropertyName]: await this.helpers.prepareBinaryData(
					data,
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
	let options: QrManyOptions;
	try {
		const domainParam = this.getNodeParameter('domain', 0);
		domainId = resolveDomainId(domainParam);
		options = this.getNodeParameter('options', 0, {}) as QrManyOptions;
	} catch (error) {
		throw toItemError.call(this, error, 0);
	}

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
			// The API declares `application/json` for this endpoint (per the digest) even though the
			// body is a ZIP, so the MIME type is hardcoded here rather than trusting the response header.
			const { data } = (await shortIoRequest.call(this, {
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
				headers: ACCEPT_RAW_IMAGE,
			})) as { data: Buffer };

			chunkItems.push({
				json: { linkIds: part.map((e) => e.value), count: part.length },
				binary: {
					data: await this.helpers.prepareBinaryData(
						data,
						`qr-codes-${chunkIndex + 1}.zip`,
						'application/zip',
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
