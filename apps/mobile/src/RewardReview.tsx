import React, { useRef, useState } from 'react';
import { Text, ToastAndroid, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { REWARD_DECIMALS, rewardDuration, rewardPlatformFee, solAccountTopUpTotal, unitsToAmount } from '@seekertag/shared/reward';
import type { RewardAction } from '@seekertag/shared/reward';
import { Button, Icon, Notice, useUI } from './ui';
import Pressable from './HapticPressable';
import { reservationDeadline } from './reward.model';
import type { RewardController } from './useReward';
import type { Translate } from './i18n';
import { RewardPendingNotice } from './RewardSummary';

export const reviewTitle = (kind: RewardAction, t: Translate) => kind === 'fund' ? t('Revisar depósito') : kind === 'renew' ? t('Revisar renovação') : kind === 'release' ? t('Confirmar devolução e pagar') : t('Cancelar e recuperar');
export default function RewardReview({ controller }: { controller: RewardController }) {
  const { s, t, locale } = useUI(); const op = controller.operation?.operation;
  if (!op) return null;
  const timed = op.spec.kind === 'fund' || op.spec.kind === 'renew';
  const platformFee = rewardPlatformFee(op.spec.amountUnits, op.spec.feeBps);
  const finderPayout = BigInt(op.spec.amountUnits) - platformFee;
  const topUpTotal = solAccountTopUpTotal(op.spec);
  const accountRent = BigInt(op.rentLamports) - topUpTotal;
  const feePercent = (op.spec.feeBps / 100).toLocaleString(locale, { maximumFractionDigits: 2 });
  const date = timed ? reservationDeadline(rewardDuration(op.spec), op.spec.kind === 'renew' && op.spec.previousRefundAfter ? new Date(op.spec.previousRefundAfter * 1_000).toISOString() : null) : null;
  return <View style={{ gap: 20 }}>
    {controller.operation?.status === 'submitted' && <RewardPendingNotice />}
    {controller.operation?.status === 'expired' && <Notice tone="warning" text={t('A aprovação expirou antes da confirmação. Revise e assine novamente.')} />}
    <View style={{ gap: 6 }}><Text style={s.small}>{t('Valor da recompensa')}</Text><Text style={s.h1}>{unitsToAmount(op.spec.amountUnits, REWARD_DECIMALS[op.currency]).replace('.', locale.startsWith('en') ? '.' : ',')} {op.currency}</Text></View>
    {op.network !== 'mainnet' && op.spec.kind !== 'fund' && op.spec.kind !== 'refund' && <Notice tone="warning" text={t('Devnet: apenas tokens de teste. Nenhum saldo real será movimentado.')} />}
    {date && <Text style={s.small}>{t('Cancelamento a partir de {date}', { date: date.toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</Text>}
    {op.spec.recipient && <Address label={t('Quem receberá')} address={op.spec.recipient} />}
    {op.spec.kind === 'release' && <Detail label={t('Quem encontrou recebe')} value={`${unitsToAmount(finderPayout, REWARD_DECIMALS[op.currency])} ${op.currency}`} />}
    {op.spec.kind === 'release' && <Detail label={t('Taxa SeekerTag ({percent}%)', { percent: feePercent })} value={`${unitsToAmount(platformFee, REWARD_DECIMALS[op.currency])} ${op.currency}`} />}
    <Detail label={t('Taxa da rede')} value={`${unitsToAmount(op.feeLamports, 9)} SOL`} />
    {accountRent > 0n && <Detail label={t('Criação de contas na rede')} value={`${unitsToAmount(accountRent, 9)} SOL`} />}
    {topUpTotal > 0n && <>
      <Text style={s.small}>{t('Algumas carteiras precisam de um saldo mínimo para receber SOL. Os complementos abaixo saem da sua carteira e permanecem com os destinatários.')}</Text>
      {BigInt(op.spec.solAccountTopUps!.recipientLamports) > 0n && <Detail label={t('Complemento para a carteira de quem encontrou')} value={`${unitsToAmount(op.spec.solAccountTopUps!.recipientLamports, 9)} SOL`} />}
      {BigInt(op.spec.solAccountTopUps!.treasuryLamports) > 0n && <Detail label={t('Complemento para a carteira SeekerTag')} value={`${unitsToAmount(op.spec.solAccountTopUps!.treasuryLamports, 9)} SOL`} />}
      <Detail label={t('Custo adicional desta operação')} value={`${unitsToAmount(BigInt(op.feeLamports) + BigInt(op.rentLamports), 9)} SOL`} />
    </>}
    <Address label={t('Carteira do depósito')} address={op.spec.payer} />
    {op.spec.kind === 'fund' && <Text style={s.small}>{t('O depósito fica bloqueado até o prazo escolhido. A conta que registra a reserva permanece na rede; seu custo de criação não é devolvido.')}</Text>}
    {op.spec.kind === 'renew' && <Text style={s.small}>{t('A renovação estende o prazo atual. O valor continua reservado.')}</Text>}
    {op.spec.kind === 'release' && <Notice tone="warning" text={t('Confirme somente se o objeto já estiver com você. O pagamento é definitivo, desconta a taxa SeekerTag de {percent}% e encerra as conversas deste objeto.', { percent: feePercent })} />}
    {op.spec.kind === 'refund' && <Text style={s.body}>{t('O depósito voltará para a carteira que o financiou. A recompensa deixará de estar reservada.')}</Text>}
  </View>;
}
export function RewardReviewAction({ controller, releaseAllowed = true }: { controller: RewardController; releaseAllowed?: boolean }) {
  const { t } = useUI(); const op = controller.operation;
  if (!op) return null;
  return op.status === 'prepared' || op.status === 'expired' ? <Button variant={op.operation.spec.kind === 'refund' ? 'warning' : 'success'} icon="check" onPress={() => void controller.approve()} busy={controller.busy}
    disabled={op.operation.spec.kind === 'release' && !releaseAllowed}>{t(op.status === 'expired' ? 'Assinar novamente' : 'Assinar na carteira')}</Button>
    : <Button variant="secondary" onPress={() => void controller.retry()} busy={controller.busy} icon="refresh-cw">{t('Verificar transação')}</Button>;
}
export function Detail({ label, value }: { label: string; value: string }) {
  const { s } = useUI();
  return <View style={{ gap: 5 }}><Text style={s.small}>{label}</Text><Text style={s.h3}>{value}</Text></View>;
}
export function Address({ label, address }: { label: string; address: string }) {
  const { C, s, t } = useUI();
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function copy() { void Clipboard.setStringAsync(address).then(() => { setCopied(true); ToastAndroid.show(t('Endereço copiado.'), ToastAndroid.SHORT); if (timeout.current) clearTimeout(timeout.current); timeout.current = setTimeout(() => setCopied(false), 2200); }); }
  return <Pressable accessibilityRole="button" accessibilityLabel={t('Copiar endereço')} onPress={copy} style={({ pressed }) => [s.row, { gap: 12, padding: 12, borderRadius: 16, backgroundColor: C.surface, opacity: pressed ? 0.72 : 1 }]}>
    <View style={{ flex: 1, gap: 5 }}><Text style={s.small}>{label}</Text><Text style={[s.body, { color: s.h3.color }]} selectable>{address.slice(0, 8)}…{address.slice(-8)}</Text></View>
    <Icon name={copied ? 'check' : 'copy'} size={20} color={copied ? C.green : C.muted} />
  </Pressable>;
}
