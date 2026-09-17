import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { RewardCurrency } from '../shared/reward';
import { MAX_REWARD_SECONDS, REWARD_DECIMALS, amountToUnits, unitsToAmount } from '../shared/reward';
import { canonicalRewardAmount, maskRewardAmount, reservationDeadline, reservationSeconds, stepRewardAmount } from './reward.model';
import type { ReservationUnit } from './reward.model';
import type { RewardController } from './useReward';
import { Button, Field, Notice, useUI } from './ui';

export const periodLabels: Record<ReservationUnit, string> = { hours: 'Horas', days: 'Dias', months: 'Meses', years: 'Anos' };
export function RewardPeriod({ quantity, unit, onQuantity, onUnit, disabled, refundAfter }: {
  quantity: string; unit: ReservationUnit; onQuantity: (value: string) => void; onUnit: (unit: ReservationUnit) => void; disabled?: boolean; refundAfter?: string | null;
}) {
  const { s, t, locale } = useUI();
  const seconds = reservationSeconds(quantity, unit);
  const deadline = seconds ? reservationDeadline(seconds, refundAfter) : null;
  const valid = deadline && deadline.getTime() <= Date.now() + MAX_REWARD_SECONDS * 1_000;
  return <View style={{ gap: 14 }}>
    <Field inSheet testID="reward-period" label={refundAfter ? t('Acrescentar ao prazo') : t('Prazo da reserva')} value={quantity}
      onChangeText={value => { if (/^\d{0,5}$/.test(value)) onQuantity(value.replace(/^0+(?=\d)/, '')); }}
      keyboardType="number-pad" maxLength={5} editable={!disabled} placeholder="30" />
    <View style={[s.row, { gap: 8 }]}>{(Object.keys(periodLabels) as ReservationUnit[]).map(option => <Button key={option} variant={unit === option ? 'primary' : 'secondary'} disabled={disabled}
      style={{ flex: 1, paddingHorizontal: 4, minHeight: 46 }} onPress={() => onUnit(option)}>{t(periodLabels[option])}</Button>)}</View>
    <Text style={s.small}>{t('De 1 hora a 5 anos. Mês = 30 dias; ano = 365 dias.')}</Text>
    {valid ? <Text style={s.small}>{t('Cancelamento a partir de {date}', { date: deadline.toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</Text>
      : !!quantity && <Notice error text={t(refundAfter ? 'A renovação não pode ultrapassar 5 anos a partir de hoje.' : 'Prazo inválido. Escolha de 1 hora a 5 anos.')} />}
  </View>;
}

export default function RewardFields({ controller, value, currency, onValue, onCurrency, disabled }: {
  controller: RewardController; value: string; currency: RewardCurrency; onValue: (value: string) => void; onCurrency: (currency: RewardCurrency) => void; disabled?: boolean;
}) {
  const { C, s, t, locale } = useUI();
  const { balance, balanceLoading, balanceError, data } = controller;
  let invalid = false; let insufficient = false;
  if (value && Number(canonicalRewardAmount(value)) !== 0) {
    try { const units = amountToUnits(canonicalRewardAmount(value), REWARD_DECIMALS[currency]); insufficient = !!balance && units > BigInt(balance.availableUnits); } catch { invalid = true; }
  }
  return <View style={{ gap: 14 }}>
    <View style={s.row}>{(['SOL', 'USDC', 'SKR'] as const).map(coin => <Button key={coin} variant={currency === coin ? 'primary' : 'secondary'}
      onPress={() => onCurrency(coin)} disabled={disabled || !!data?.config && !data.config.currencies.includes(coin)} style={{ flex: 1, paddingHorizontal: 8 }}>{coin}</Button>)}</View>
    <Text style={s.label}>{t('Valor da recompensa')}</Text>
    <View style={[s.row, { alignItems: 'center', gap: 8 }]}>
      <Button variant="secondary" icon="minus" label={t('Diminuir recompensa')} disabled={disabled || !Number(canonicalRewardAmount(value)) || invalid} onPress={() => onValue(stepRewardAmount(value, currency, -1, locale))} />
      <View style={{ flex: 1 }}><Field inSheet hideLabel testID="object-reward" label={t('Valor da recompensa')} value={value}
        onChangeText={next => onValue(maskRewardAmount(next, value, currency, locale))} keyboardType="decimal-pad" editable={!disabled} placeholder="0" maxLength={18} /></View>
      <Button variant="secondary" icon="plus" label={t('Aumentar recompensa')} disabled={disabled || invalid || Number(canonicalRewardAmount(value)) >= 1_000_000} onPress={() => onValue(stepRewardAmount(value, currency, 1, locale))} />
    </View>
    {data?.payer && <View style={s.between}><View style={{ flex: 1 }}>{balanceLoading ? <ActivityIndicator color={C.muted} style={{ alignSelf: 'flex-start' }} />
      : <Text style={s.small}>{t('Disponível: {amount} {currency}', { amount: balance ? unitsToAmount(balance.availableUnits, balance.decimals).replace('.', locale.startsWith('en') ? '.' : ',') : '—', currency })}</Text>}</View>
      <Button variant="ghost" icon="refresh-cw" label={t('Atualizar saldo')} onPress={controller.refreshBalance} disabled={disabled || balanceLoading} /></View>}
    {invalid && <Notice error text={t('Use até {decimals} casas decimais.', { decimals: REWARD_DECIMALS[currency] })} />}
    {insufficient && <Notice error text={t('Saldo insuficiente para este valor.')} />}
    {!!balanceError && <Notice error text={balanceError} />}
  </View>;
}
