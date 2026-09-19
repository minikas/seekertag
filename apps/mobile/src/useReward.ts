import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, ToastAndroid } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { REWARD_DECIMALS, unitsToAmount } from '@seekertag/shared/reward';
import type { RewardAction, RewardBalance, RewardConfig, RewardCurrency, RewardOperation, RewardOperationStatus, RewardPrices, RewardView } from '@seekertag/shared/reward';
import { api } from './api';
import { apiQueryKey, apiQueryOptions, invalidateApiResources, queryClient } from './query';
import { useUI } from './ui';
import { validateRewardIntent } from './reward.model';
import { signReward } from './platform/reward-wallet';
import { secureStorage } from './platform/storage';
import { submitSignedRewardOperation } from './reward-submission';
import { translateNotice } from './i18n';

type State = { reward: RewardView | null; config: RewardConfig | null; payer: string | null };
export type OperationState = { operation: RewardOperation; status: RewardOperationStatus; reward: RewardView | null };
type Props = { tagId?: string; token: string; currency: RewardCurrency; reportId?: string; recipient?: string | null; onChanged?: (reward: RewardView | null) => void; onReleased?: () => void; onCompleted?: () => void };
export function useReward({ tagId, token, currency, reportId, recipient, onChanged, onReleased, onCompleted }: Props) {
  const { t } = useUI();
  const base = tagId ? `/tags/${tagId}/reward` : '/rewards/config';
  const identity = `${token}:${base}`;
  const activeIdentity = useRef(identity); activeIdentity.current = identity;
  const alive = useRef(true);
  const acting = useRef(false);
  const revision = useRef(0);
  const callbacks = useRef({ onChanged, onReleased, onCompleted }); callbacks.current = { onChanged, onReleased, onCompleted };
  const completed = useRef<string | null>(null);
  const dismissedReviews = useRef<Set<string>>(new Set());
  const [localOperation, setLocalOperation] = useState<{ identity: string; value?: OperationState }>({ identity });
  const operation = localOperation.identity === identity ? localOperation.value : undefined;
  const currentOperation = useRef(operation); currentOperation.current = operation;
  const [error, setError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const storageKey = (id: string) => `reward-signed-${id}`;
  const isCurrent = () => alive.current && activeIdentity.current === identity;
  function setOperation(value: OperationState | undefined) {
    if (!isCurrent()) return;
    currentOperation.current = value; setLocalOperation({ identity, value });
  }
  useEffect(() => {
    alive.current = true;
    completed.current = null; dismissedReviews.current = new Set();
    setError(''); setRecoveryError('');
    return () => { alive.current = false; revision.current += 1; };
  }, [identity]);

  const action = useMutation({
    retry: false,
    // Wallet signing must never be queued for later by an offline mutation.
    networkMode: 'always',
    mutationFn: async (task: () => Promise<void>) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: apiQueryKey(token, base), exact: true }),
        ...(currentOperation.current ? [queryClient.cancelQueries({ queryKey: apiQueryKey(token, `/reward-operations/${currentOperation.current.operation.id}`), exact: true })] : []),
      ]);
      await task();
    },
  });
  const recovery = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ operationId, transaction }: { operationId: string; transaction: string }) => submitSignedRewardOperation(token, operationId, transaction),
  });
  const busy = action.isPending || recovery.isPending;
  const stateQuery = useQuery({ ...apiQueryOptions<State>(base, token), enabled: !busy, refetchInterval: 5000 });
  const data = stateQuery.data;
  // Keep the review the user just prepared while its parent resource refetches.
  const operationId = operation?.operation.id || data?.reward?.operation?.id;
  const operationPath = `/reward-operations/${operationId || 'none'}`;
  const operationQuery = useQuery({ ...apiQueryOptions<OperationState>(operationPath, token), enabled: !!operationId && !busy, refetchInterval: 5000 });
  const pricesQuery = useQuery({ ...apiQueryOptions<RewardPrices>('/rewards/prices', token), staleTime: 0 });
  // A cached quote can remain in Query after expiry, but must never be presented
  // as a live fiat conversion. Its server deadline governs display exactly.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const expiresAt = pricesQuery.data?.expiresAt;
    setNow(Date.now());
    if (!expiresAt || expiresAt <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [pricesQuery.data?.expiresAt]);
  const prices = pricesQuery.data && pricesQuery.data.expiresAt > Math.max(now, Date.now()) ? pricesQuery.data : undefined;
  const balancePath = `/rewards/balance?currency=${currency}`;
  const balanceEnabled = !!data?.payer && !!data.config?.currencies.includes(currency);
  const balanceQuery = useQuery({
    queryKey: [...apiQueryKey(token, balancePath), data?.payer, data?.config?.network],
    queryFn: ({ signal }) => api<RewardBalance>(balancePath, token, undefined, 'GET', signal),
    enabled: balanceEnabled,
  });

  function updateReward(reward: RewardView | null) {
    if (!isCurrent()) return;
    const previous = queryClient.getQueryData<State>(apiQueryKey(token, base));
    // Avoid creating a new cache update on every reconciliation/poll tick.
    if (previous && JSON.stringify(previous.reward) !== JSON.stringify(reward)) {
      queryClient.setQueryData<State>(apiQueryKey(token, base), { ...previous, reward });
    }
    callbacks.current.onChanged?.(reward);
  }
  function markSubmitted(current: OperationState) {
    const reward = current.reward ? { ...current.reward, operation: { id: current.operation.id, kind: current.operation.spec.kind, status: 'submitted' } } : null;
    storeOperation({ ...current, status: 'submitted', reward });
    updateReward(reward);
  }
  function storeOperation(value: OperationState) {
    if (!isCurrent()) return;
    queryClient.setQueryData(apiQueryKey(token, `/reward-operations/${value.operation.id}`), value);
    setOperation(value);
  }

  const attemptedRecovery = useRef('');
  useEffect(() => {
    if (!data || busy || acting.current) return;
    const snapshot = operationQuery.data;
    if (operationId && (!snapshot || snapshot.operation.id !== operationId)) return;
    let live = true;
    const started = revision.current;
    const current = () => live && isCurrent() && !acting.current && started === revision.current;
    async function reconcile() {
      let op = snapshot;
      if (op?.status === 'prepared') {
        const signed = await secureStorage.get(storageKey(op.operation.id));
        if (!current()) return;
        if (signed) {
          // The exact stored bytes recover an interrupted submit. This runs as a
          // mutation, never in a queryFn or a retried wallet-signing callback.
          const attempt = `${identity}:${op.operation.id}:${operationQuery.dataUpdatedAt}`;
          if (attemptedRecovery.current === attempt) return;
          attemptedRecovery.current = attempt;
          const prepared = op;
          markSubmitted(prepared);
          recovery.mutate({ operationId: prepared.operation.id, transaction: signed }, {
            onSuccess: result => {
              if (!isCurrent()) return;
              queryClient.setQueryData(apiQueryKey(token, `/reward-operations/${prepared.operation.id}`), { ...prepared, ...result });
              updateReward(result.reward); setRecoveryError('');
              void invalidateApiResources(token, ['/tags', '/reports', '/rewards', '/reward-operations']);
            },
            onError: cause => { if (isCurrent()) setRecoveryError(cause.message); },
          });
          return;
        }
      }
      if (!current()) return;
      if (op && dismissedReviews.current.has(op.operation.id)) op = undefined;
      if (op && data!.reward && data!.reward.id !== op.operation.rewardId) op = undefined;
      const reward = op ? op.reward : data!.reward;
      if (op && (['prepared', 'submitted'].includes(op.status) || op.status === 'expired' && ['prepared', 'expired'].includes(currentOperation.current?.status || ''))) {
        setOperation({ ...op, reward: op.reward || currentOperation.current?.reward || null });
      } else {
        const previous = currentOperation.current;
        setOperation(undefined);
        setRecoveryError('');
        if (previous) {
          void secureStorage.remove(storageKey(previous.operation.id)).catch(() => {});
          void invalidateApiResources(token, ['/rewards/balance']);
          if (op?.status === 'confirmed' && reward && completed.current !== previous.operation.id) {
            completed.current = previous.operation.id;
            void invalidateApiResources(token, ['/tags', '/reports', '/rewards', '/reward-operations']);
            const kind = previous.operation.spec.kind;
            ToastAndroid.show(kind === 'fund' ? t('Depósito confirmado.') : kind === 'renew' ? t('Reserva renovada.') : kind === 'refund' ? t('Depósito recuperado.') : t('Recompensa entregue.'), ToastAndroid.LONG);
            if (kind === 'release') callbacks.current.onReleased?.();
            callbacks.current.onCompleted?.();
          } else if (op?.status === 'expired' && previous.status === 'submitted' && previous.operation.spec.kind === 'fund') {
            ToastAndroid.show(t('A transação expirou sem confirmação. Nenhum depósito foi confirmado.'), ToastAndroid.LONG);
          }
        }
      }
      updateReward(reward);
    }
    void reconcile().catch(cause => { if (current()) setRecoveryError(cause.message); });
    return () => { live = false; };
  }, [identity, data, stateQuery.dataUpdatedAt, operationId, operationQuery.data, operationQuery.dataUpdatedAt, busy, t]);

  const load = useCallback(() => invalidateApiResources(token, [base, '/reward-operations']), [base, token]);
  async function act(task: () => Promise<void>, allowed = isCurrent) {
    if (acting.current || recovery.isPending) return false;
    acting.current = true; revision.current += 1; setError(''); setRecoveryError(''); Keyboard.dismiss();
    try { await action.mutateAsync(async () => { if (allowed()) await task(); }); return allowed(); } catch (cause) {
      if (allowed()) {
        const message = cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.';
        ToastAndroid.show(translateNotice(t, message), ToastAndroid.LONG);
      }
      return false;
    } finally {
      acting.current = false;
      if (allowed()) void invalidateApiResources(token, [base, '/reward-operations', '/rewards/balance']);
    }
  }
  async function review(kind: RewardAction, input?: { amount: string; currency: RewardCurrency; durationSeconds?: number }, savedTagId = tagId) {
    if (!data?.config || !data.payer || !savedTagId) return false;
    // Add item saves the item before preparing its first deposit. That one
    // explicit config -> saved-item transition may finish across a rerender;
    // switching accounts or to a different existing item still rejects it.
    const targetIdentity = `${token}:/tags/${savedTagId}/reward`;
    const allowed = () => isCurrent() || (!tagId && alive.current && activeIdentity.current === targetIdentity);
    return act(async () => {
      const reward = data.reward;
      const intent = { kind, currency: kind === 'fund' ? input!.currency : reward!.currency, amount: kind === 'fund' ? input!.amount : reward!.amount,
        ...(['fund','renew'].includes(kind) ? { durationSeconds: input?.durationSeconds } : {}),
        ...(kind === 'release' && reportId && recipient ? { recipient, reportHash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, reportId) } : {}) };
      const result = await api<{ operation: RewardOperation }>(`/tags/${savedTagId}/reward/prepare`, token, { ...intent, reportId });
      validateRewardIntent(result.operation, intent, data.config!, data.payer!);
      dismissedReviews.current.delete(result.operation.id);
      if (allowed()) {
        const prepared: OperationState = { ...result, status: 'prepared', reward };
        queryClient.setQueryData(apiQueryKey(token, `/reward-operations/${result.operation.id}`), prepared);
        currentOperation.current = prepared;
        setLocalOperation({ identity: activeIdentity.current, value: prepared });
        void invalidateApiResources(token, [`/tags/${savedTagId}/reward`]);
      }
    }, allowed);
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
        if (isCurrent()) storeOperation(current);
      }
      if (current.status !== 'prepared') { if (isCurrent()) storeOperation(current); return; }
      const op = current.operation;
      validateRewardIntent(op, intent, data.config!, data.payer!);
      // Fees or required accounts may have changed since an expired review.
      // Show their updated cost before asking for a signature.
      if (op.feeLamports !== reviewed.feeLamports || op.rentLamports !== reviewed.rentLamports
        || (op.spec.solAccountTopUps?.recipientLamports || '0') !== (reviewed.spec.solAccountTopUps?.recipientLamports || '0')
        || (op.spec.solAccountTopUps?.treasuryLamports || '0') !== (reviewed.spec.solAccountTopUps?.treasuryLamports || '0')) {
        if (isCurrent()) { storeOperation(current); setError('As taxas mudaram. Revise os valores atualizados e toque em Assinar novamente.'); }
        return;
      }
      let signed = await secureStorage.get(storageKey(op.id));
      if (!isCurrent()) return;
      if (!signed) signed = await signReward(op);
      if (!signed) { if (isCurrent()) ToastAndroid.show(t('Assinatura cancelada.'), ToastAndroid.SHORT); return; }
      // Save before sending: if the API times out or Android closes the app, the
      // same signed transaction can be submitted again without another debit.
      await secureStorage.set(storageKey(op.id), signed);
      if (isCurrent()) markSubmitted(current);
      const result = await submitSignedRewardOperation(token, op.id, signed);
      if (isCurrent()) { storeOperation({ ...current, ...result }); updateReward(result.reward); }
    });
  }

  async function retry() {
    if (!operation) return;
    await act(async () => {
      const signed = await secureStorage.get(storageKey(operation.operation.id));
      if (signed) await submitSignedRewardOperation(token, operation.operation.id, signed);
      else await api(`/reward-operations/${operation.operation.id}/retry`, token, {});
      const next = await api<OperationState>(`/reward-operations/${operation.operation.id}`, token);
      if (isCurrent()) { storeOperation(next); updateReward(next.reward); }
    });
  }

  function editExpiredReview() {
    if (operation?.status !== 'expired' || acting.current) return;
    void secureStorage.remove(storageKey(operation.operation.id)).catch(() => {});
    currentOperation.current = undefined; setOperation(undefined);
  }
  function discardReview() {
    if (!operation || acting.current || operation.status === 'submitted') return;
    dismissedReviews.current.add(operation.operation.id);
    void secureStorage.remove(storageKey(operation.operation.id)).catch(() => {});
    currentOperation.current = undefined; setOperation(undefined);
  }
  const loading = stateQuery.isPending || (!!operationId && operationQuery.isPending);
  const loadError = stateQuery.error?.message || operationQuery.error?.message || recoveryError;
  return { data, prices, pricesLoading: pricesQuery.isFetching, refreshPrices: () => pricesQuery.refetch(), operation, editExpiredReview, discardReview, busy, loading, error: error || loadError,
    balance: balanceEnabled ? balanceQuery.data : undefined, balanceLoading: balanceEnabled && balanceQuery.isFetching, balanceError: balanceEnabled ? balanceQuery.error?.message || '' : '',
    load, review, approve, retry, refreshBalance: () => { if (balanceEnabled) return balanceQuery.refetch(); } };
}
export type RewardController = ReturnType<typeof useReward>;
