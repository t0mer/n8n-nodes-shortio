import { vi } from 'vitest';
import type { INode } from 'n8n-workflow';
import type { ShortIoContext } from '../shared/transport';

export const NODE: INode = {
	id: '1',
	name: 'Short.io',
	type: 'CUSTOM.shortIo',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export type Resp = { statusCode: number; headers?: Record<string, string>; body: unknown };

export function fakeCtx(responses: Resp[], extra: Record<string, unknown> = {}): ShortIoContext {
	const queue = [...responses];
	const httpRequestWithAuthentication = vi.fn(async () => {
		const r = queue.shift();
		if (!r) throw new Error('no more fake responses');
		return { headers: {}, ...r };
	});
	const httpRequest = vi.fn();
	return {
		getNode: () => NODE,
		helpers: {
			httpRequestWithAuthentication,
			httpRequest,
			prepareBinaryData: vi.fn(async (b: Buffer, f?: string, m?: string) => ({
				data: b.toString('base64'),
				fileName: f,
				mimeType: m,
			})),
		},
		...extra,
	} as unknown as ShortIoContext;
}
