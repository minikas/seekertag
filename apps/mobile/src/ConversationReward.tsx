import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiQueryKey, apiQueryOptions } from './query';
import type { RewardView } from '@seekertag/shared/reward';
import type { Report } from './api';
import { Button, Notice, useUI } from './ui';
import ReceivingWalletSheet from './ReceivingWalletSheet';
import RewardSummary from './RewardSummary';
import RewardReleaseSheet from './RewardReleaseSheet';
import { Address } from './RewardReview';
import { rewardLocked } from './reward.model';

export type ConversationRewardData = { reward: RewardView | null; recipient: string | null; tagId: string };
export default function ConversationReward({ id, token, finder, open, onLocked, onReleased, showSummary = true, amount = 0, currency = 'SOL', onReceivingWallet, refreshKey = 0, showReceivingWalletAction = true }: { id: string; token: string; finder: boolean; open: boolean; onLocked: (locked: boolean) => void; onReleased: () => void; showSummary?: boolean; amount?: number; currency?: string; onReceivingWallet?: () => void; refreshKey?: number; showReceivingWalletAction?: boolean }) {
  const { C, s, t } = useUI();
  const queryClient = useQueryClient();
  const [receivingWallet, setReceivingWallet] = useState(false);
  const [show, setShow] = useState(false);
  const callbacks = useRef({ onLocked, onReleased }); callbacks.current = { onLocked, onReleased };
  const path = `${finder ? '/finder' : ''}/reports/${id}/reward`;
  const rewardQuery = useQuery({ ...apiQueryOptions<ConversationRewardData>(path, token), refetchInterval: show ? false : 6000 });
  const data = rewardQuery.data;
  const error = rewardQuery.error?.message || '';
  const reportQuery = useQuery({ ...apiQueryOptions<{ report: Report }>(`${finder ? '/finder' : ''}/reports/${id}`, token),
    enabled: open && data?.reward?.status === 'released' });
  useEffect(() => {
    if (error) callbacks.current.onLocked(true);
    else if (data) callbacks.current.onLocked(rewardLocked(data.reward) || !!data.reward?.operation);
  }, [data, error]);
  useEffect(() => {
    if (open && data?.reward?.status === 'released' && reportQuery.data?.report.status === 'resolved') callbacks.current.onReleased();
  }, [open, data?.reward?.status, reportQuery.data?.report.status]);
  useEffect(() => { if (refreshKey) void rewardQuery.refetch(); }, [refreshKey, rewardQuery.refetch]);
  const load = () => rewardQuery.refetch();
  const update = (change: Partial<ConversationRewardData>) => queryClient.setQueryData<ConversationRewardData>(apiQueryKey(token, path), previous => previous ? { ...previous, ...change } : previous);
  if (!data && !error) return <View style={{ gap: 16 }} accessibilityLabel={t('Carregando recompensa')}>
    <View style={[s.card, { gap: 14 }]}>
      <View style={{ width: '44%', height: 18, borderRadius: 9, backgroundColor: C.surface }} />
      <View style={{ width: '32%', height: 28, borderRadius: 8, backgroundColor: C.surface }} />
      <View style={{ width: '24%', height: 14, borderRadius: 7, backgroundColor: C.surface }} />
    </View>
    {open && <View style={{ width: '100%', height: 52, borderRadius: 18, backgroundColor: C.surface }} />}
  </View>;
  return <View style={{ gap: 12 }}>
    {showSummary && (data?.reward || amount > 0) && <View style={[s.between, s.card, { padding: 16 }]}><RewardSummary reward={data?.reward} amount={amount} currency={currency} /></View>}
    {!!error && <><Notice error text={error} /><Button variant="ghost" onPress={() => void load()}>{t('Tentar novamente')}</Button></>}
    {open && data && rewardLocked(data.reward) && (finder ? <>
      {data.recipient ? <Address label={t('Sua carteira de recebimento')} address={data.recipient} /> : <>
        {showReceivingWalletAction && <Button variant="accent" icon="edit-3" onPress={onReceivingWallet || (() => setReceivingWallet(true))}>{t('Informar carteira de recebimento')}</Button>}
      </>}
    </> : <>
      {!data.recipient && <Notice text={t('Quem encontrou precisa confirmar a carteira de recebimento na conversa.')} />}
      <Button variant="success" icon="check-circle" onPress={() => setShow(true)} disabled={!data.recipient || !!error}>{t('Finalizar devolução')}</Button>
    </>)}
    {receivingWallet && <ReceivingWalletSheet id={id} token={token} onClose={() => setReceivingWallet(false)}
      onSaved={recipient => { update({ recipient }); setReceivingWallet(false); void load(); }} />}
    {show && data && <RewardReleaseSheet tagId={data.tagId} token={token} reportId={id} recipient={data.recipient}
      onClose={() => { setShow(false); void load(); }}
      onChanged={reward => { update({ reward }); callbacks.current.onLocked(rewardLocked(reward) || !!reward?.operation); }}
      onReleased={() => callbacks.current.onReleased()} />}
  </View>;
}
