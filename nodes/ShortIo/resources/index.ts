import type { HandlerRegistry } from '../../../shared/types';
import { domainDescription } from './domain/description';
import { domainHandlers } from './domain/execute';
import { linkDescription } from './link/description';
import { linkHandlers } from './link/execute';

export const HANDLERS: HandlerRegistry = {
	domain: domainHandlers,
	link: linkHandlers,
};

export { domainDescription, linkDescription };
