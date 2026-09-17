import React from 'react';
import { Text, View } from 'react-native';
import type { RewardView } from '../shared/reward';
import { Icon, useUI } from './ui';

export default function RewardSummary({ reward, amount = 0, currency = 'SOL' }: { reward?: RewardView | null; amount?: number; currency?: string }) {
  const { C, s, t, locale } = useUI();
  const label = reward?.status === 'reserved' ? t('Recompensa reservada') : reward?.status === 'pending' ? t('Depósito pendente') : reward?.status === 'expired' ? t('Prazo encerrado') : reward?.status === 'released' ? t('Recompensa entregue') : reward?.status === 'refunded' ? t('Depósito recuperado') : reward?.status === 'unverified' ? t('Reserva não verificada') : t('Recompensa');
  const success = reward?.status === 'reserved' || reward?.status === 'released';
  const warning = reward?.status === 'expired' || reward?.status === 'unverified';
  const color = success ? C.green : warning ? C.amber : C.muted;
  return <View style={[s.row, { alignItems: 'center', flex: 1 }]}>
    <View style={[s.settingsIcon, { backgroundColor: success ? C.greenSoft : warning ? C.amberSoft : C.raised }]}><Icon name={success ? 'check-circle' : 'gift'} size={20} color={color} /></View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={[s.label, { color }]}>{label}</Text>
      <Text style={s.h3}>{reward ? `${reward.amount} ${reward.currency}` : amount > 0 ? `${amount.toLocaleString(locale)} ${currency}` : t('Reservar uma recompensa')}</Text>
      {reward && reward.network !== 'mainnet' ? <Text style={s.small}>{t('Rede de teste · sem valor real')}</Text> : !reward && amount > 0 ? <Text style={s.small}>{t('Valor anunciado, ainda sem depósito.')}</Text> : null}
    </View>
  </View>;
}
