import { api, ApiError } from './api';
import { createMutationStore, mutationBody, MutationPayload, PendingMutation } from './mutationStore';
import { secureStorage } from './platform/storage';
import { createOperationKey } from './platform/random';
export type { PendingMutation, MutationPayload } from './mutationStore';
const mutations = createMutationStore(secureStorage, createOperationKey);
export const loadPendingMutation = mutations.load;
export const prepareMutation = mutations.prepare;
export const completeMutation = mutations.complete;
export function executeMutation<T>(pending: PendingMutation, token?: string | null, sensitiveFields?: MutationPayload): Promise<T> {
  return api<T>(pending.path, token, mutationBody(pending, sensitiveFields));
}
export function isDefiniteMutationRejection(error: unknown): boolean {
  return error instanceof ApiError && ((error.status === 400 && ['INVALID_REQUEST', 'INVALID_OPERATION_KEY', 'INVALID_JSON'].includes(error.code || '')) || (error.status === 413 && error.code === 'BODY_TOO_LARGE'));
}
