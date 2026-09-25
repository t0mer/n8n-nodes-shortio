import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import type { ExecContext, HandlerRegistry } from '../../shared/types';

/**
 * Resolves `resource`/`operation` to a handler in `handlers` and runs it:
 * - `item` handlers run once per input item; the router attaches `pairedItem` to their output
 *   and, under continue-on-fail, turns a thrown error into a `{ error, statusCode? }` item.
 * - `batch` handlers run once for all input items and are trusted to set their own `pairedItem`.
 */
export async function runOperations(
	this: IExecuteFunctions,
	handlers: HandlerRegistry,
	ctx: ExecContext,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const resource = this.getNodeParameter('resource', 0) as string;
	const operation = this.getNodeParameter('operation', 0) as string;
	const entry = handlers[resource]?.[operation];

	if (!entry) {
		throw new NodeOperationError(
			this.getNode(),
			`Unsupported operation "${operation}" for resource "${resource}"`,
		);
	}

	if (entry.kind === 'batch') {
		return [await entry.run.call(this, items, ctx)];
	}

	const out: INodeExecutionData[] = [];
	for (let i = 0; i < items.length; i++) {
		let failure: Error | undefined;
		try {
			const result = await entry.run.call(this, i, ctx);
			for (const item of result) {
				out.push({ ...item, pairedItem: { item: i } });
			}
		} catch (error) {
			if (this.continueOnFail()) {
				const apiError = error as NodeApiError;
				out.push({
					json: {
						error: (error as Error).message,
						...(apiError.httpCode ? { statusCode: Number(apiError.httpCode) } : {}),
					},
					pairedItem: { item: i },
				});
				continue;
			}

			if (error instanceof NodeApiError || error instanceof NodeOperationError) {
				error.context.itemIndex = i;
				failure = error;
			} else {
				failure = new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		if (failure) throw failure;
	}

	return [out];
}
