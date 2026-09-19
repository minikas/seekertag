import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import type { RewardView } from '@seekertag/shared/reward';
import { api, type Report } from './api';
import { Button, Notice, useUI } from './ui';
import ReceivingWalletSheet from './ReceivingWalletSheet';
import RewardSummary from './RewardSummary';
import RewardReleaseSheet from './RewardReleaseSheet';
import { Address } from './RewardReview';
import { rewardLocked } from './reward.model';

type State = { reward: RewardView | null; recipient: string | null; tagId: string };
export default function ConversationReward({ id, token, finder, open, onLocked, onReleased, showSummary = true, amount = 0, currency = 'SOL' }: { id: string; token: string; finder: boolean; open: boolean; onLocked: (locked: boolean) => void; onReleased: () => void; showSummary?: boolean; amount?: number; currency?: string }) {
  const { C, s, t } = useUI();
  const [data, setData] = useState<State>();
  const [error, setError] = useState('');
  const [receivingWallet, setReceivingWallet] = useState(false);
  const [show, setShow] = useState(false);
  const alive = useRef(true); const fetching = useRef(false);
  const callbacks = useRef({ onLocked, onReleased }); callbacks.current = { onLocked, onReleased };
  const wasPaid = useRef(false);
  const path = `${finder ? '/finder' : ''}/reports/${id}/reward`;
  const load = useCallback(async () => {
    if (fetching.current || AppState.currentState !== 'active') return;
    fetching.current = true;
    try {
      const next = await api<State>(path, token);
      if (!alive.current) return;
      setData(next); setError(''); callbacks.current.onLocked(rewardLocked(next.reward) || !!next.reward?.operation);
      if (open && next.reward?.status === 'released' && !wasPaid.current) {
        // A previous reward may still be visible after a new loss. Only close
        // this conversation when the server confirms its own returned state.
        const { report } = await api<{ report: Report }>(`${finder ? '/finder' : ''}/reports/${id}`, token);
        if (alive.current) { wasPaid.current = true; if (report.status === 'resolved') callbacks.current.onReleased(); }
      }
    } catch (cause) { if (alive.current) { setError((cause as Error).message); callbacks.current.onLocked(true); } }
    finally { fetching.current = false; }
  }, [path, token, finder, id, open]);
  useEffect(() => {
    alive.current = true; void load(); const timer = setInterval(() => { if (!show) void load(); }, 6000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && !show) void load(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, [load, show]);
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
        <Button variant="accent" icon="edit-3" onPress={() => setReceivingWallet(true)}>{t('Informar carteira de recebimento')}</Button>
      </>}
    </> : <>
      {!data.recipient && <Notice text={t('Quem encontrou precisa confirmar a carteira de recebimento na conversa.')} />}
      <Button variant="success" icon="check-circle" onPress={() => setShow(true)} disabled={!data.recipient || !!error}>{t('Finalizar devolução')}</Button>
    </>)}
    {receivingWallet && <ReceivingWalletSheet id={id} token={token} onClose={() => setReceivingWallet(false)}
      onSaved={recipient => { setData(previous => previous ? { ...previous, recipient } : previous); setReceivingWallet(false); void load(); }} />}
    {show && data && <RewardReleaseSheet tagId={data.tagId} token={token} reportId={id} recipient={data.recipient}
      onClose={() => { setShow(false); void load(); }}
      onChanged={reward => { setData(prev => prev ? { ...prev, reward } : prev); callbacks.current.onLocked(rewardLocked(reward) || !!reward?.operation); }}
      onReleased={() => callbacks.current.onReleased()} />}
  </View>;
}
