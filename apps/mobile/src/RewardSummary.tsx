import React from 'react';
import { Text, View } from 'react-native';
import type { RewardNetwork, RewardView } from '@seekertag/shared/reward';
import { Icon, useUI } from './ui';
import { rewardAwaitingConfirmation } from './reward.model';

export default function RewardSummary({ reward, amount = 0, currency = 'SOL', loading = false }: { reward?: RewardView | null; amount?: number; currency?: string; loading?: boolean }) {
  const { C, s, t, locale } = useUI();
  if (loading) return <View style={[s.row, { alignItems: 'center', flex: 1, gap: 12 }]}><View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: C.raised }} /><View style={{ flex: 1, gap: 10 }}><View style={{ width: '48%', height: 18, borderRadius: 9, backgroundColor: C.raised }} /><View style={{ width: '28%', height: 24, borderRadius: 8, backgroundColor: C.raised }} /></View></View>;
  const waiting = rewardAwaitingConfirmation(reward);
  const label = waiting ? t('Aguardando confirmação') : reward?.status === 'reserved' ? t('Recompensa reservada') : reward?.status === 'pending' ? t('Depósito pendente') : reward?.status === 'expired' ? t('Prazo encerrado') : reward?.status === 'released' ? t('Recompensa entregue') : reward?.status === 'refunded' ? t('Depósito recuperado') : reward?.status === 'unverified' ? t('Reserva não verificada') : t('Recompensa');
  const success = !waiting && (reward?.status === 'reserved' || reward?.status === 'released');
  const warning = waiting || reward?.status === 'expired' || reward?.status === 'unverified';
  const color = success ? C.green : warning ? C.amber : C.muted;
  return <View style={[s.row, { alignItems: 'center', flex: 1 }]}>
    <View style={[s.settingsIcon, { backgroundColor: success ? C.greenSoft : warning ? C.amberSoft : C.raised }]}><Icon name={waiting ? 'clock' : success ? 'check-circle' : 'gift'} size={20} color={color} /></View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={[s.label, { color }]}>{label}</Text>
      <Text style={s.h3}>{reward ? `${reward.amount} ${reward.currency}` : amount > 0 ? `${amount.toLocaleString(locale)} ${currency}` : t('Reservar uma recompensa')}</Text>
      {reward && reward.network !== 'mainnet' ? <RewardNetworkBadge network={reward.network} /> : !reward && amount > 0 ? <Text style={s.small}>{t('Valor anunciado, ainda sem depósito.')}</Text> : null}
    </View>
  </View>;
}

export function RewardPendingNotice() {
  const { C, s, t } = useUI();
  return <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
    <View style={[s.row, { alignSelf: 'flex-start', borderRadius: 20, backgroundColor: C.amberSoft, paddingHorizontal: 12, paddingVertical: 7 }]}>
      <Icon name="clock" size={16} color={C.amber} />
      <Text style={[s.small, { color: C.amber, fontWeight: '600', flexShrink: 1 }]}>{t('Aguardando confirmação')}</Text>
    </View>
    <Text style={s.small}>{t('Edição bloqueada até a rede confirmar o resultado. Você pode sair desta tela.')}</Text>
  </View>;
}

export function RewardNetworkBadge({ network }: { network: RewardNetwork }) {
  const { C, s } = useUI();
  if (network === 'mainnet') return null;
  return <View style={{ alignSelf: 'flex-start', backgroundColor: C.amberSoft, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 }}>
    <Text style={[s.small, { color: C.amber, fontWeight: '600', fontSize: 12 }]}>{network === 'devnet' ? 'Devnet' : 'Localnet'}</Text>
  </View>;
}
