import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { RewardView } from '../shared/reward';
import { api } from './api';
import { Button, Notice, useUI } from './ui';
import { confirmFinderWallet } from './platform/reward-wallet';
import RewardSummary from './RewardSummary';
import RewardReleaseSheet from './RewardReleaseSheet';
import { Address } from './RewardReview';
import { rewardLocked } from './reward.model';

type State = { reward: RewardView | null; recipient: string | null; tagId: string };
export default function ConversationReward({ id, token, finder, open, onLocked, onReleased }: { id: string; token: string; finder: boolean; open: boolean; onLocked: (locked: boolean) => void; onReleased: () => void }) {
  const { C, s, t, locale } = useUI();
  const [data, setData] = useState<State>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const alive = useRef(true); const fetching = useRef(false); const acting = useRef(false);
  const callbacks = useRef({ onLocked, onReleased }); callbacks.current = { onLocked, onReleased };
  const wasPaid = useRef(false);
  const path = `${finder ? '/finder' : ''}/reports/${id}/reward`;
  const load = useCallback(async () => {
    if (fetching.current || acting.current || AppState.currentState !== 'active') return;
    fetching.current = true;
    try {
      const next = await api<State>(path, token);
      if (!alive.current) return;
      setData(next); setError(''); callbacks.current.onLocked(rewardLocked(next.reward));
      if (next.reward?.status === 'released' && !wasPaid.current) { wasPaid.current = true; callbacks.current.onReleased(); }
    } catch (cause) { if (alive.current) { setError((cause as Error).message); callbacks.current.onLocked(true); } }
    finally { fetching.current = false; }
  }, [path, token]);
  useEffect(() => {
    alive.current = true; void load(); const timer = setInterval(() => { if (!show) void load(); }, 6000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && !show) void load(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, [load, show]);
  async function connect() {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError('');
    try {
      const recipient = await confirmFinderWallet(id, token, locale.slice(0, 2));
      if (alive.current && recipient) setData(prev => prev ? { ...prev, recipient } : prev);
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }
  if (!data?.reward && !error) return <View style={{ gap: 16 }} accessibilityLabel={t('Carregando recompensa')}>
    <View style={[s.card, { gap: 14 }]}>
      <View style={{ width: '44%', height: 18, borderRadius: 9, backgroundColor: C.surface }} />
      <View style={{ width: '32%', height: 28, borderRadius: 8, backgroundColor: C.surface }} />
      <View style={{ width: '24%', height: 14, borderRadius: 7, backgroundColor: C.surface }} />
    </View>
    {open && <View style={{ width: '100%', height: 52, borderRadius: 18, backgroundColor: C.surface }} />}
  </View>;
  return <View style={{ gap: 16 }}>
    {data?.reward && <RewardSummary reward={data.reward} />}
    {!!error && <><Notice error text={error} /><Button variant="ghost" onPress={() => void load()}>{t('Tentar novamente')}</Button></>}
    {open && data?.reward && rewardLocked(data.reward) && (finder ? <>
      {data.recipient ? <Address label={t('Sua carteira de recebimento')} address={data.recipient} /> : <>
        <Text style={s.small}>{t('Confirme sua carteira para receber após a devolução. Vincular a carteira não cobra taxas e não autoriza pagamentos.')}</Text>
        <Button variant="accent" icon="link" onPress={() => void connect()} busy={busy}>{t('Confirmar carteira de recebimento')}</Button>
      </>}
      <Text style={s.small}>{t('O dono precisa confirmar a devolução e assinar o pagamento. Após o prazo, ele também pode cancelar e recuperar o depósito.')}</Text>
    </> : <Button variant="success" icon="check-circle" onPress={() => setShow(true)}>{t('Devolução e recompensa')}</Button>)}
    {show && data && <RewardReleaseSheet tagId={data.tagId} token={token} reportId={id} recipient={data.recipient}
      onClose={() => { setShow(false); void load(); }}
      onChanged={reward => { setData(prev => prev ? { ...prev, reward } : prev); callbacks.current.onLocked(rewardLocked(reward)); }}
      onReleased={() => callbacks.current.onReleased()} />}
  </View>;
}
