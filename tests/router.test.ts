import { describe, expect, it } from 'vitest';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { runOperations } from '../nodes/ShortIo/router';
import { DomainCache } from '../shared/locators';
import type { ExecContext, HandlerRegistry } from '../shared/types';
import { NODE } from './helpers';

function fakeExec(params: Record<string, unknown>, items: INodeExecutionData[], continueOnFail = false) {
	return {
		getNode: () => NODE,
		getInputData: () => items,
		getNodeParameter: (name: string) => params[name],
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}

const execContext: ExecContext = { domains: new DomainCache() };

describe('runOperations', () => {
	it('adds pairedItem to each output item returned by an item handler', async () => {
		const handlers: HandlerRegistry = {
			thing: {
				get: {
					kind: 'item',
					run: async (i) => [{ json: { i } }],
				},
			},
		};
		const exec = fakeExec({ resource: 'thing', operation: 'get' }, [{ json: {} }, { json: {} }]);

		const [out] = await runOperations.call(exec, handlers, execContext);

		expect(out).toEqual([
			{ json: { i: 0 }, pairedItem: { item: 0 } },
			{ json: { i: 1 }, pairedItem: { item: 1 } },
		]);
	});

	it('produces a {json:{error,statusCode},pairedItem} item under continue-on-fail', async () => {
		const apiError = new NodeApiError(NODE, { message: 'boom' }, { httpCode: '404' });
		const handlers: HandlerRegistry = {
			thing: {
				get: {
					kind: 'item',
					run: async () => {
						throw apiError;
					},
				},
			},
		};
		const exec = fakeExec({ resource: 'thing', operation: 'get' }, [{ json: {} }], true);

		const [out] = await runOperations.call(exec, handlers, execContext);

		expect(out).toEqual([
			{ json: { error: apiError.message, statusCode: 404 }, pairedItem: { item: 0 } },
		]);
	});

	it('produces a {json:{error},pairedItem} item (no statusCode) under continue-on-fail for a plain Error', async () => {
		const plainError = new Error('oops');
		const handlers: HandlerRegistry = {
			thing: {
				get: {
					kind: 'item',
					run: async () => {
						throw plainError;
					},
				},
			},
		};
		const exec = fakeExec({ resource: 'thing', operation: 'get' }, [{ json: {} }], true);

		const [out] = await runOperations.call(exec, handlers, execContext);

		expect(out).toEqual([{ json: { error: plainError.message }, pairedItem: { item: 0 } }]);
		expect(out[0].json).not.toHaveProperty('statusCode');
	});

	it('wraps a plain Error as NodeOperationError with itemIndex when not continuing on fail', async () => {
		const plainError = new Error('boom');
		const handlers: HandlerRegistry = {
			thing: {
				get: {
					kind: 'item',
					run: async (i) => {
						if (i === 1) throw plainError;
						return [{ json: {} }];
					},
				},
			},
		};
		const exec = fakeExec({ resource: 'thing', operation: 'get' }, [{ json: {} }, { json: {} }], false);

		const error = await runOperations.call(exec, handlers, execContext).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as NodeOperationError).context.itemIndex).toBe(1);
	});

	it('passes a batch handler output through untouched', async () => {
		const batchOut: INodeExecutionData[] = [{ json: { a: 1 }, pairedItem: { item: 0 } }];
		const handlers: HandlerRegistry = {
			thing: {
				bulk: {
					kind: 'batch',
					run: async () => batchOut,
				},
			},
		};
		const exec = fakeExec({ resource: 'thing', operation: 'bulk' }, [{ json: {} }]);

		const result = await runOperations.call(exec, handlers, execContext);

		expect(result).toEqual([batchOut]);
	});

	it('sets itemIndex on context and rethrows an existing NodeOperationError without continue-on-fail', async () => {
		const opError = new NodeOperationError(NODE, 'bad input');
		const handlers: HandlerRegistry = {
			thing: {
				get: {
					kind: 'item',
					run: async () => {
						throw opError;
					},
				},
			},
		};
		const exec = fakeExec({ resource: 'thing', operation: 'get' }, [{ json: {} }, { json: {} }], false);

		await expect(runOperations.call(exec, handlers, execContext)).rejects.toBe(opError);
		expect(opError.context.itemIndex).toBe(0);
	});

	it('throws NodeOperationError for an unsupported resource/operation pair', async () => {
		const exec = fakeExec({ resource: 'missing', operation: 'get' }, [{ json: {} }]);

		await expect(runOperations.call(exec, {}, execContext)).rejects.toThrow(NodeOperationError);
	});
});
