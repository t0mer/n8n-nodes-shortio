import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import type { DomainCache } from './locators';

export interface ExecContext {
	domains: DomainCache;
}

/**
 * Per-item operation. Returns output items WITHOUT pairedItem (the router adds it).
 * JSON results: `return this.helpers.returnJsonArray(data)`; binary results: `return [{ json, binary }]`.
 */
export type ItemHandler = (
	this: IExecuteFunctions,
	i: number,
	ctx: ExecContext,
) => Promise<INodeExecutionData[]>;

/** Whole-input operation (bulk). Must set pairedItem itself. */
export type BatchHandler = (
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	ctx: ExecContext,
) => Promise<INodeExecutionData[]>;

export type OperationEntry = { kind: 'item'; run: ItemHandler } | { kind: 'batch'; run: BatchHandler };

export type HandlerRegistry = Record<string, Record<string, OperationEntry>>;
