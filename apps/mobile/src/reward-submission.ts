import type { RewardOperationStatus, RewardView } from '@seekertag/shared/reward';
import { api } from './api';

type Submission = { status: RewardOperationStatus; reward: RewardView | null };
const pending = new Map<string, Promise<Submission>>();

// Details and an open reward sheet can recover the same interrupted request.
// Share that in-flight submission; the API's operation ID remains the durable
// idempotency boundary. Never sign or automatically retry a failed request here.
export function submitSignedRewardOperation(token: string, operationId: string, transaction: string): Promise<Submission> {
  const key = JSON.stringify([token, operationId]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = api<Submission>(`/reward-operations/${operationId}/submit`, token, { transaction })
    .finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}
