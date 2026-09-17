import React, { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Text, View } from 'react-native';
import type { RewardCurrency } from '../shared/reward';
import { MAX_REWARD_SECONDS, REWARD_DECIMALS, amountToUnits, unitsToAmount } from '../shared/reward';
import { canonicalRewardAmount, maskRewardAmount, reservationDeadline, reservationSeconds, stepRewardAmount, percentageRewardAmount } from './reward.model';
import type { ReservationUnit } from './reward.model';
import type { RewardController } from './useReward';
import Pressable from './HapticPressable';
import AccountActionSheet, { AccountActionSheetHandle } from './AccountActionSheet';
import { ProviderMark } from './ProviderButton';
import { Button, Field, Icon, Notice, useUI } from './ui';

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

function TokenMark({ currency }: { currency: RewardCurrency }) {
  const { C } = useUI();
  return <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: currency === 'USDC' ? '#2775CA' : C.soft }}>
    {currency === 'SOL' ? <ProviderMark provider="solana" color={C.accent} /> : <Text style={{ color: currency === 'USDC' ? 'white' : C.accent, fontSize: 17, fontWeight: '700' }}>{currency === 'USDC' ? '$' : 'S'}</Text>}
  </View>;
}

export default function RewardFields({ controller, value, currency, onValue, onCurrency, disabled }: {
  controller: RewardController; value: string; currency: RewardCurrency; onValue: (value: string) => void; onCurrency: (currency: RewardCurrency) => void; disabled?: boolean;
}) {
  const { C, s, t, locale } = useUI();
  const [picker, setPicker] = useState(false);
  const [fiat, setFiat] = useState<'usd' | 'brl'>(locale.startsWith('pt') ? 'brl' : 'usd');
  const pickerRef = useRef<AccountActionSheetHandle>(null);
  const { balanceLoading, balanceError, data, prices, pricesLoading } = controller;
  const balance = controller.balance?.currency === currency ? controller.balance : undefined;
  const quote = prices && prices.expiresAt > Date.now() ? prices.quotes[currency] : undefined;
  const amount = Number(canonicalRewardAmount(value));
  let invalid = false; let insufficient = false;
  if (value && amount !== 0) {
    try { const units = amountToUnits(canonicalRewardAmount(value), REWARD_DECIMALS[currency]); insufficient = !!balance && units > BigInt(balance.fundableUnits ?? balance.availableUnits); } catch { invalid = true; }
  }
  const canUseBalance = !disabled && !balanceLoading && !!balance?.fundableUnits && BigInt(balance.fundableUnits) > 0n;
  const estimate = quote && !invalid && Number.isFinite(amount) ? (amount * quote[fiat]).toLocaleString(locale, { style: 'currency', currency: fiat.toUpperCase(), maximumFractionDigits: 2 }) : null;
  const refresh = () => { controller.refreshBalance(); controller.refreshPrices(); };
  return <View style={{ gap: 14 }}>
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 24, padding: 16, gap: 10 }}>
      <View style={s.between}>
        <Text style={[s.small, { flex: 1 }]}>{t('Valor da recompensa')}</Text>
        <View style={[s.row, { gap: 0 }]}>{([-1, 1] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityLabel={t(direction === -1 ? 'Diminuir recompensa' : 'Aumentar recompensa')} disabled={disabled || invalid || (direction === -1 ? !amount : amount >= 1_000_000)} onPress={() => onValue(stepRewardAmount(value, currency, direction, locale))} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled || invalid || (direction === -1 && !amount) ? 0.35 : pressed ? 0.6 : 1 })}><Icon name={direction === -1 ? 'minus' : 'plus'} size={20} /></Pressable>)}</View>
      </View>
      <View style={[s.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}><Field inSheet hideLabel testID="object-reward" label={t('Valor da recompensa')} value={value}
          onChangeText={next => onValue(maskRewardAmount(next, value, currency, locale))} keyboardType="decimal-pad" editable={!disabled} placeholder="0" maxLength={18}
          style={{ backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 62, fontSize: value.length > 10 ? 26 : 38, lineHeight: 48, fontWeight: '500' }} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Selecionar moeda')} accessibilityValue={{ text: currency }} disabled={disabled} onPress={() => { Keyboard.dismiss(); setPicker(true); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: C.line, opacity: pressed || disabled ? 0.6 : 1 })}>
          <TokenMark currency={currency} /><Text style={[s.h3, { fontSize: 17 }]}>{currency}</Text><Icon name="chevron-down" size={16} color={C.muted} />
        </Pressable>
      </View>
      <View style={[s.between, { alignItems: 'flex-start' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Alternar cotação entre USD e BRL')} onPress={() => setFiat(fiat === 'usd' ? 'brl' : 'usd')} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
          <Text style={s.small}>{pricesLoading ? t('Consultando cotação…') : estimate ? `≈ ${estimate}` : t('Cotação indisponível')}</Text>
          <Text style={[s.small, { color: C.accent }]}>{fiat.toUpperCase()} ↔</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'flex-end', paddingTop: 4 }}>{balanceLoading ? <ActivityIndicator color={C.muted} /> : <Text style={[s.small, { textAlign: 'right' }]}>{t('Disponível: {amount} {currency}', { amount: balance ? unitsToAmount(balance.availableUnits, balance.decimals).replace('.', locale.startsWith('en') ? '.' : ',') : '—', currency })}</Text>}</View>
      </View>
    </View>
    <View style={[s.row, { gap: 8 }]}>{([25, 50, 75, 100] as const).map(percent => <Pressable key={percent} accessibilityRole="button" accessibilityLabel={t('Usar {percent}% do saldo disponível', { percent })} accessibilityState={{ disabled: !canUseBalance }} disabled={!canUseBalance} onPress={() => onValue(percentageRewardAmount(balance!.fundableUnits!, currency, percent, locale))}
      style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, opacity: !canUseBalance ? 0.4 : pressed ? 0.65 : 1 })}><Text style={[s.small, { color: C.ink, fontWeight: '600' }]}>{percent === 100 ? t('Máx.') : `${percent}%`}</Text></Pressable>)}</View>
    <View style={s.between}><View style={{ flex: 1, gap: 3 }}>
      <Text style={s.small}>{data?.config?.network !== 'mainnet' ? t('Referência de mercado · {network}', { network: data?.config?.network === 'devnet' ? 'Devnet' : data?.config?.network || '—' }) : t('Valor estimado')} · CoinGecko</Text>
      {!!balance?.reserveLamports && <Text style={s.small}>{t('Máx. preserva SOL para os custos estimados do depósito.')}</Text>}
    </View><Button variant="ghost" icon="refresh-cw" label={t('Atualizar saldo e cotação')} onPress={refresh} disabled={disabled || balanceLoading || pricesLoading} /></View>
    {invalid && <Notice error text={t('Use até {decimals} casas decimais.', { decimals: REWARD_DECIMALS[currency] })} />}
    {insufficient && <Notice error text={t('Saldo insuficiente para a recompensa e os custos do depósito.')} />}
    {!!balanceError && <Notice error text={balanceError} />}
    {picker && <AccountActionSheet ref={pickerRef} title={t('Selecionar moeda')} onClose={() => setPicker(false)}>
      <View>{(['SOL', 'USDC', 'SKR'] as const).map(coin => {
        const unavailable = !data?.config?.currencies.includes(coin);
        return <Pressable key={coin} accessibilityRole="radio" accessibilityLabel={coin} accessibilityState={{ checked: currency === coin, disabled: unavailable || disabled }} disabled={unavailable || disabled} onPress={() => { onCurrency(coin); pickerRef.current?.dismiss(); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 72, paddingVertical: 16, opacity: unavailable ? 0.4 : pressed ? 0.6 : 1 })}>
          <TokenMark currency={coin} /><View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{coin}</Text><Text style={s.small}>{{ SOL: 'Solana', USDC: 'USD Coin', SKR: 'Seeker' }[coin]}</Text></View>{currency === coin && <Icon name="check" color={C.accent} size={22} />}
        </Pressable>;
      })}</View>
    </AccountActionSheet>}
  </View>;
}
