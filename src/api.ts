import Constants from 'expo-constants';
import type { RewardView } from '../shared/reward';

const host = Constants.expoConfig?.hostUri?.split(':')[0];
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || `http://${host || '10.0.2.2'}:4318/api`).replace(/\/$/, '');
export type Provider = 'solana' | 'google' | 'apple';
export type User = { id: string; name: string; email: string | null; createdAt: string; hasPassword: boolean; providers: Provider[]; walletAddress: string | null };
export type Category = { id: string; name: string; icon: string; color: string; defaultKey: string | null; tagCount: number };
export type Tag = { id: string; code: string; name: string; category: string; categoryId: string | null; categoryIcon: string; categoryDefaultKey: string | null; color: string; description: string; publicMessage: string; status: 'active' | 'lost' | 'paused'; rewardAmount: number; rewardCurrency: string; publicUrl: string; createdAt: string; updatedAt: string; returnedAt: string | null; recoveryCount: number; reportCount: number; openReportCount: number; reward?: RewardView | null };
export type Report = { id: string; tagId: string; tagName: string; tagCode: string; finderName: string; status: 'open' | 'resolved'; createdAt: string; updatedAt: string; lastMessage: string; messageCount: number };
export type Message = { id: number; role: 'owner' | 'finder'; body: string; createdAt: string };
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, token?: string | null, body?: unknown, method?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const data = response.status === 204 ? undefined : await response.json();
    if (!response.ok) throw new ApiError(data?.error || 'Não foi possível concluir. Tente novamente.', response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('Não foi possível conectar. Verifique sua conexão e tente novamente.');
  } finally { clearTimeout(timeout); }
}
