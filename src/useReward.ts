import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, ToastAndroid } from 'react-native';
import * as Crypto from 'expo-crypto';
import { REWARD_DECIMALS, unitsToAmount } from '../shared/reward';
import type { RewardAction, RewardBalance, RewardConfig, RewardCurrency, RewardOperation, RewardOperationStatus, RewardView } from '../shared/reward';
import { api } from './api';
import { useUI } from './ui';
import { validateRewardIntent } from './reward.model';
import { signReward } from './platform/reward-wallet';
import { secureStorage } from './platform/storage';
import { translateNotice } from './i18n';

type State = { reward: RewardView | null; config: RewardConfig | null; payer: string | null };
export type OperationState = { operation: RewardOperation; status: RewardOperationStatus; reward: RewardView | null };
type Props = { tagId?: string; token: string; currency: RewardCurrency; reportId?: string; recipient?: string | null; onChanged?: (reward: RewardView | null) => void; onReleased?: () => void; onCompleted?: () => void };
export function useReward({ tagId, token, currency, reportId, recipient, onChanged, onReleased, onCompleted }: Props) {
  const { t } = useUI();
  const [data, setData] = useState<State>();
  const [balance, setBalance] = useState<RewardBalance>();
  const [balanceError, setBalanceError] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceRevision, setBalanceRevision] = useState(0);
  const [operation, setOperation] = useState<OperationState>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const revision = useRef(0);
  const alive = useRef(true); const acting = useRef(false); const fetching = useRef(false);
  const callbacks = useRef({ onChanged, onReleased, onCompleted }); callbacks.current = { onChanged, onReleased, onCompleted };
  const completed = useRef<string | null>(null);
  const currentOperation = useRef(operation); currentOperation.current = operation;
  const base = tagId ? `/tags/${tagId}/reward` : '/rewards/config';
  const activeBase = useRef(base); activeBase.current = base;
  const storageKey = (id: string) => `reward-signed-${id}`;

  function markSubmitted(current: OperationState) {
    const reward = current.reward ? { ...current.reward, operation: { id: current.operation.id, kind: current.operation.spec.kind, status: 'submitted' } } : null;
    const pending: OperationState = { ...current, status: 'submitted', reward };
    currentOperation.current = pending; setOperation(pending);
    setData(previous => previous ? { ...previous, reward } : previous);
    callbacks.current.onChanged?.(reward);
  }

  const load = useCallback(async () => {
    if (fetching.current || acting.current || AppState.currentState !== 'active') return;
    fetching.current = true; const started = revision.current;
    try {
      const next = await api<State>(base, token);
      let op: OperationState | undefined;
      const operationId = next.reward?.operation?.id || currentOperation.current?.operation.id;
      if (operationId) op = await api<OperationState>(`/reward-operations/${operationId}`, token);
      if (!alive.current || acting.current || activeBase.current !== base || started !== revision.current) return;
      if (op?.status === 'prepared') {
        const signed = await secureStorage.get(storageKey(op.operation.id));
        if (!alive.current || acting.current || activeBase.current !== base || started !== revision.current) return;
        if (signed) {
          // A lost submit response must not reopen the editor or ask for another
          // signature. Recover the exact signed request stored before sending.
          markSubmitted(op);
          const result = await api<{ status: RewardOperationStatus; reward: RewardView | null }>(`/reward-operations/${op.operation.id}/submit`, token, { transaction: signed });
          op = { ...op, ...result };
        }
      }
      if (!alive.current || acting.current || activeBase.current !== base || started !== revision.current) return;
      if (op && next.reward && next.reward.id !== op.operation.rewardId) op = undefined;
      if (op) next.reward = op.reward;
      setData(next);
      callbacks.current.onChanged?.(next.reward);
      if (op && (['prepared', 'submitted'].includes(op.status) || op.status === 'expired' && ['prepared', 'expired'].includes(currentOperation.current?.status || ''))) setOperation({ ...op, reward: op.reward || currentOperation.current?.reward || null });
      else {
        const previous = currentOperation.current;
        setOperation(undefined);
        if (previous) {
          void secureStorage.remove(storageKey(previous.operation.id)).catch(() => {});
          setBalanceRevision(n => n + 1);
          if (op?.status === 'confirmed' && next.reward && completed.current !== previous.operation.id) {
            completed.current = previous.operation.id;
            const kind = previous.operation.spec.kind;
            ToastAndroid.show(kind === 'fund' ? t('Depósito confirmado.') : kind === 'renew' ? t('Reserva renovada.') : kind === 'refund' ? t('Depósito recuperado.') : t('Recompensa entregue.'), ToastAndroid.LONG);
            if (kind === 'release') callbacks.current.onReleased?.();
            callbacks.current.onCompleted?.();
          } else if (op?.status === 'expired' && previous.status === 'submitted' && previous.operation.spec.kind === 'fund') {
            ToastAndroid.show(t('A transação expirou sem confirmação. Nenhum depósito foi confirmado.'), ToastAndroid.LONG);
          }
        }
      }
      setLoadError('');
    } catch (cause) { if (alive.current) setLoadError((cause as Error).message); }
    finally { fetching.current = false; if (alive.current) setLoading(false); }
  }, [base, token, t]);

  useEffect(() => {
    alive.current = true; void load();
    const timer = setInterval(() => { void load(); }, 5000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, [load]);

  useEffect(() => {
    let current = true; setBalance(undefined); setBalanceError('');
    if (!data?.config || !data.payer || !data.config.currencies.includes(currency)) return;
    setBalanceLoading(true);
    void api<RewardBalance>(`/rewards/balance?currency=${currency}`, token).then(result => { if (current) setBalance(result); })
      .catch(cause => { if (current) setBalanceError(cause.message); }).finally(() => { if (current) setBalanceLoading(false); });
    return () => { current = false; };
  }, [base, token, currency, data?.payer, data?.config?.network, balanceRevision]);

  async function act(task: () => Promise<void>) {
    if (acting.current) return false;
    acting.current = true; revision.current += 1; setBusy(true); setError(''); Keyboard.dismiss();
    try { await task(); return true; } catch (cause) { if (alive.current) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.';
      // Action failures are transient feedback. Keep the review available for
      // retry without duplicating the toast in a permanent footer banner.
      ToastAndroid.show(translateNotice(t, message), ToastAndroid.LONG);
    } return false; }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }

  async function review(kind: RewardAction, input?: { amount: string; currency: RewardCurrency; durationSeconds?: number }, savedTagId = tagId) {
    if (!data?.config || !data.payer || !savedTagId) return false;
    return act(async () => {
      const reward = data.reward;
      const intent = { kind, currency: kind === 'fund' ? input!.currency : reward!.currency, amount: kind === 'fund' ? input!.amount : reward!.amount,
        ...(['fund','renew'].includes(kind) ? { durationSeconds: input?.durationSeconds } : {}),
        ...(kind === 'release' && reportId && recipient ? { recipient, reportHash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, reportId) } : {}) };
      const result = await api<{ operation: RewardOperation }>(`/tags/${savedTagId}/reward/prepare`, token, { ...intent, reportId });
      validateRewardIntent(result.operation, intent, data.config!, data.payer!);
      if (alive.current) setOperation({ ...result, status: 'prepared', reward });
    });
  }

  async function approve() {
    if (!operation || !data?.config || !data.payer) return;
    await act(async () => {
      // Refresh expiry before opening the wallet. A restored review must match
      // the current reserve and this conversation's verified receiving address.
      let current = await api<OperationState>(`/reward-operations/${operation.operation.id}`, token);
      const reviewed = operation.operation;
      const intent = { kind: reviewed.spec.kind, currency: reviewed.currency, amount: unitsToAmount(reviewed.spec.amountUnits, REWARD_DECIMALS[reviewed.currency]), days: reviewed.spec.days, durationSeconds: reviewed.spec.durationSeconds,
        ...(reviewed.spec.kind === 'release' ? { recipient: recipient || undefined, reportHash: reportId ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, reportId) : undefined } : {}) };
      if (current.status === 'expired') {
        // Only replace a transaction after the API has checked finalized state
        // past its blockhash expiry. Preserve every value the user reviewed.
        const fresh = await api<{ operation: RewardOperation }>(`${base}/prepare`, token, { ...intent, reportId });
        await secureStorage.remove(storageKey(reviewed.id)).catch(() => {});
        current = { ...fresh, status: 'prepared', reward: current.reward };
        if (alive.current) setOperation(current);
      }
      if (current.status !== 'prepared') { if (alive.current) setOperation(current); return; }
      const op = current.operation;
      validateRewardIntent(op, intent, data.config!, data.payer!);
      // Fees or required accounts may have changed since an expired review.
      // Show their updated cost before asking for a signature.
      if (op.feeLamports !== reviewed.feeLamports || op.rentLamports !== reviewed.rentLamports) {
        if (alive.current) setError('As taxas mudaram. Revise os valores atualizados e toque em Assinar novamente.');
        return;
      }
      let signed = await secureStorage.get(storageKey(op.id));
      if (!alive.current) return;
      if (!signed) signed = await signReward(op);
      if (!signed) { if (alive.current) ToastAndroid.show(t('Assinatura cancelada.'), ToastAndroid.SHORT); return; }
      // Save before sending: if the API times out or Android closes the app, the
      // same signed transaction can be submitted again without another debit.
      await secureStorage.set(storageKey(op.id), signed);
      if (alive.current) markSubmitted(current);
      const result = await api<{ status: RewardOperationStatus; reward: RewardView | null }>(`/reward-operations/${op.id}/submit`, token, { transaction: signed });
      if (alive.current) { setOperation({ ...current, ...result }); setData(prev => prev ? { ...prev, reward: result.reward } : prev); callbacks.current.onChanged?.(result.reward); }
    });
  }

  async function retry() {
    if (!operation) return;
    await act(async () => {
      const signed = await secureStorage.get(storageKey(operation.operation.id));
      if (signed) await api(`/reward-operations/${operation.operation.id}/submit`, token, { transaction: signed });
      else await api(`/reward-operations/${operation.operation.id}/retry`, token, {});
      const next = await api<OperationState>(`/reward-operations/${operation.operation.id}`, token);
      if (alive.current) { setOperation(next); setData(prev => prev ? { ...prev, reward: next.reward } : prev); callbacks.current.onChanged?.(next.reward); }
    });
  }

  function editExpiredReview() {
    if (operation?.status !== 'expired' || acting.current) return;
    void secureStorage.remove(storageKey(operation.operation.id)).catch(() => {});
    currentOperation.current = undefined; setOperation(undefined);
  }
  return { data, operation, editExpiredReview, busy, loading, error: error || loadError, balance, balanceLoading, balanceError,
    load, review, approve, retry, refreshBalance: () => setBalanceRevision(n => n + 1) };
}
export type RewardController = ReturnType<typeof useReward>;
