import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the authenticated user's id for the lifetime of one request,
 * without threading it through every function call. authGuard sets it;
 * queueCommand() reads it to stamp "Sent by User" on commands it queues —
 * stays NULL for device-initiated/system paths that never go through authGuard.
 */
export const requestContext = new AsyncLocalStorage();

export const getCurrentUserId = () => requestContext.getStore()?.userId ?? null;
