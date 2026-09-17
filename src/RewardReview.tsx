import React from 'react';
import { Text, ToastAndroid, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { REWARD_DECIMALS, rewardDuration, unitsToAmount } from '../shared/reward';
import type { RewardAction } from '../shared/reward';
import { Button, Notice, useUI } from './ui';
import { reservationDeadline } from './reward.model';
import type { RewardController } from './useReward';
import type { Translate } from './i18n';
import { RewardPendingNotice } from './RewardSummary';

export const reviewTitle = (kind: RewardAction, t: Translate) => kind === 'fund' ? t('Revisar depósito') : kind === 'renew' ? t('Revisar renovação') : kind === 'release' ? t('Confirmar devolução e pagar') : t('Cancelar e recuperar');
export default function RewardReview({ controller }: { controller: RewardController }) {
  const { s, t, locale } = useUI(); const op = controller.operation?.operation;
  if (!op) return null;
  const timed = op.spec.kind === 'fund' || op.spec.kind === 'renew';
  const date = timed ? reservationDeadline(rewardDuration(op.spec), op.spec.kind === 'renew' && op.spec.previousRefundAfter ? new Date(op.spec.previousRefundAfter * 1_000).toISOString() : null) : null;
  return <View style={{ gap: 20 }}>
    {controller.operation?.status === 'submitted' && <RewardPendingNotice />}
    <View style={{ gap: 6 }}><Text style={s.small}>{t('Valor da recompensa')}</Text><Text style={s.h1}>{unitsToAmount(op.spec.amountUnits, REWARD_DECIMALS[op.currency]).replace('.', locale.startsWith('en') ? '.' : ',')} {op.currency}</Text></View>
    {op.network !== 'mainnet' && op.spec.kind !== 'refund' && <Notice tone="warning" text={t('Devnet: apenas tokens de teste. Nenhum saldo real será movimentado.')} />}
    {date && <Detail label={t('Cancelamento previsto a partir de')} value={date.toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />}
    {op.spec.recipient && <Address label={t('Quem receberá')} address={op.spec.recipient} />}
    <Detail label={t('Taxa da rede')} value={`${unitsToAmount(op.feeLamports, 9)} SOL`} />
    {BigInt(op.rentLamports) > 0n && <Detail label={t('Criação de contas na rede')} value={`${unitsToAmount(op.rentLamports, 9)} SOL`} />}
    <Address label={t('Carteira do depósito')} address={op.spec.payer} />
    {op.spec.kind === 'fund' && <Text style={s.small}>{t('O depósito fica bloqueado até o prazo escolhido. A conta que registra a reserva permanece na rede; seu custo de criação não é devolvido.')}</Text>}
    {op.spec.kind === 'renew' && <Text style={s.small}>{t('A renovação estende o prazo atual. O valor continua reservado.')}</Text>}
    {op.spec.kind === 'release' && <Notice tone="warning" text={t('Confirme somente se o objeto já estiver com você. O pagamento é definitivo e encerra as conversas deste objeto.')} />}
    {op.spec.kind === 'refund' && <Text style={s.body}>{t('O depósito voltará para a carteira que o financiou. A recompensa deixará de estar reservada.')}</Text>}
  </View>;
}
export function RewardReviewAction({ controller, releaseAllowed = true }: { controller: RewardController; releaseAllowed?: boolean }) {
  const { t } = useUI(); const op = controller.operation;
  if (!op) return null;
  return op.status === 'prepared' || op.status === 'expired' ? <Button variant={op.operation.spec.kind === 'refund' ? 'warning' : 'success'} icon="check" onPress={() => void controller.approve()} busy={controller.busy}
    disabled={op.operation.spec.kind === 'release' && !releaseAllowed}>{t('Assinar na carteira')}</Button>
    : <Button variant="secondary" onPress={() => void controller.retry()} busy={controller.busy} icon="refresh-cw">{t('Verificar transação')}</Button>;
}
export function Detail({ label, value }: { label: string; value: string }) {
  const { s } = useUI();
  return <View style={{ gap: 5 }}><Text style={s.small}>{label}</Text><Text style={s.h3}>{value}</Text></View>;
}
export function Address({ label, address }: { label: string; address: string }) {
  const { s, t } = useUI();
  return <View style={s.between}><View style={{ flex: 1, gap: 5 }}><Text style={s.small}>{label}</Text><Text style={[s.body, { color: s.h3.color }]} selectable>{address.slice(0, 8)}…{address.slice(-8)}</Text></View><Button variant="ghost" icon="copy" label={t('Copiar endereço')} onPress={() => { void Clipboard.setStringAsync(address).then(() => ToastAndroid.show(t('Endereço copiado.'), ToastAndroid.SHORT)); }} /></View>;
}
