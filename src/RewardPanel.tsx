import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, Text, ToastAndroid, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { amountToUnits, REWARD_DECIMALS, unitsToAmount, validRewardDays } from '../shared/reward';
import type { RewardAction, RewardBalance, RewardConfig, RewardCurrency, RewardOperation, RewardOperationStatus, RewardView } from '../shared/reward';
import { api } from './api';
import { Button, Field, Icon, Notice, useUI } from './ui';
import { rewardDeadline, rewardLocked, validateRewardIntent } from './reward.model';
import { signReward } from './platform/reward-wallet';
import { secureStorage } from './platform/storage';
import RewardSummary from './RewardSummary';

type State = { reward: RewardView | null; config: RewardConfig | null; payer: string | null };
type OperationState = { operation: RewardOperation; status: RewardOperationStatus; reward: RewardView | null };
type Props = { tagId: string; token: string; amount?: number; currency?: string; reportId?: string; recipient?: string | null; onChanged?: (reward: RewardView | null) => void; onReleased?: () => void };

export default function RewardPanel({ tagId, token, amount = 0, currency: initialCurrency = 'SOL', reportId, recipient, onChanged, onReleased }: Props) {
  const { C, s, t, locale } = useUI();
  const supported = ['SOL', 'USDC', 'SKR'].includes(initialCurrency);
  const [data, setData] = useState<State>();
  const [currency, setCurrency] = useState<RewardCurrency>(supported ? initialCurrency as RewardCurrency : 'SOL');
  const [value, setValue] = useState(amount && supported ? String(amount) : '');
  const [days, setDays] = useState('30');
  const [mode, setMode] = useState<RewardAction>('fund');
  const [balance, setBalance] = useState<RewardBalance>();
  const [balanceError, setBalanceError] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceRevision, setBalanceRevision] = useState(0);
  const [operation, setOperation] = useState<OperationState>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const acting = useRef(false);
  const fetching = useRef(false);
  const callbacks = useRef({ onChanged, onReleased }); callbacks.current = { onChanged, onReleased };
  const completed = useRef<string | null>(null);
  const currentOperation = useRef(operation); currentOperation.current = operation;
  const base = `/tags/${tagId}/reward`;
  const storageKey = (id: string) => `reward-signed-${id}`;

  const load = useCallback(async () => {
    if (fetching.current || acting.current || AppState.currentState !== 'active') return;
    fetching.current = true;
    try {
      const next = await api<State>(base, token);
      let op: OperationState | undefined;
      if (next.reward?.operation) op = await api<OperationState>(`/reward-operations/${next.reward.operation.id}`, token);
      if (!alive.current || acting.current) return;
      if (op) next.reward = op.reward;
      setData(next);
      callbacks.current.onChanged?.(next.reward);
      if (op && ['prepared', 'submitted'].includes(op.status)) setOperation(op);
      else {
        const previous = currentOperation.current;
        setOperation(undefined);
        if (previous) {
          void secureStorage.remove(storageKey(previous.operation.id)).catch(() => {});
          setMode('fund'); setBalanceRevision(n => n + 1);
          if (next.reward && previous.operation.spec.kind === 'release' && next.reward.status === 'released' && completed.current !== previous.operation.id) {
            completed.current = previous.operation.id;
            callbacks.current.onReleased?.();
          }
        }
      }
      setError('');
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { fetching.current = false; if (alive.current) setLoading(false); }
  }, [base, token]);

  useEffect(() => {
    alive.current = true; void load();
    const timer = setInterval(() => { void load(); }, 5000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); };
  }, [load]);

  useEffect(() => {
    let current = true; setBalance(undefined); setBalanceError('');
    if (!data?.config || !data.payer || !data.config.currencies.includes(currency)) return;
    setBalanceLoading(true);
    void api<RewardBalance>(`${base}/balance?currency=${currency}`, token).then(result => { if (current) setBalance(result); })
      .catch(cause => { if (current) setBalanceError(cause.message); }).finally(() => { if (current) setBalanceLoading(false); });
    return () => { current = false; };
  }, [base, token, currency, data?.payer, data?.config?.network, balanceRevision]);

  async function act(task: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    try { await task(); } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }

  async function review(kind: RewardAction) {
    if (!data?.config || !data.payer) return;
    await act(async () => {
      const reward = data.reward;
      const intent = { kind, currency: kind === 'fund' ? currency : reward!.currency, amount: kind === 'fund' ? value.replace(',', '.') : reward!.amount,
        ...(['fund','renew'].includes(kind) ? { days: Number(days) } : {}),
        ...(kind === 'release' && reportId && recipient ? { recipient, reportHash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, reportId) } : {}) };
      const result = await api<{ operation: RewardOperation }>(`${base}/prepare`, token, { ...intent, reportId });
      validateRewardIntent(result.operation, intent, data.config!, data.payer!);
      if (alive.current) { setOperation({ ...result, status: 'prepared', reward }); setMode(kind); }
    });
  }

  async function approve() {
    if (!operation || !data?.config || !data.payer) return;
    await act(async () => {
      // Refresh expiry before opening the wallet. A restored review must match
      // the current reserve and this conversation's verified receiving address.
      const current = await api<OperationState>(`/reward-operations/${operation.operation.id}`, token);
      if (current.status !== 'prepared') { if (alive.current) setOperation(current); return; }
      const op = current.operation;
      const reward = current.reward;
      const intent = { kind: op.spec.kind, currency: reward!.currency, amount: reward!.amount, days: op.spec.days,
        ...(op.spec.kind === 'release' ? { recipient: recipient || undefined, reportHash: reportId ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, reportId) : undefined } : {}) };
      validateRewardIntent(op, intent, data.config!, data.payer!);
      let signed = await secureStorage.get(storageKey(op.id));
      if (!signed) signed = await signReward(op);
      if (!signed) { if (alive.current) ToastAndroid.show(t('Assinatura cancelada.'), ToastAndroid.SHORT); return; }
      // Save before sending: if the API times out or Android closes the app, the
      // same signed transaction can be submitted again without another debit.
      await secureStorage.set(storageKey(op.id), signed);
      const result = await api<{ status: RewardOperationStatus; reward: RewardView | null }>(`/reward-operations/${op.id}/submit`, token, { transaction: signed });
      if (alive.current) { setOperation({ ...current, ...result }); setData(prev => prev ? { ...prev, reward: result.reward } : prev); }
    });
  }

  async function retry() {
    if (!operation) return;
    await act(async () => {
      await api(`/reward-operations/${operation.operation.id}/retry`, token, {});
      const next = await api<OperationState>(`/reward-operations/${operation.operation.id}`, token);
      if (alive.current) { setOperation(next); setData(prev => prev ? { ...prev, reward: next.reward } : prev); }
    });
  }

  const reward = data?.reward;
  const locked = rewardLocked(reward);
  const hasReserve = reward?.status === 'reserved' || reward?.status === 'expired';
  const testing = data?.config && data.config.network !== 'mainnet';
  const date = (value: string | Date) => new Date(value).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let amountValid = false;
  try { amountValid = !!balance && amountToUnits(value.replace(',', '.'), REWARD_DECIMALS[currency]) <= BigInt(balance.availableUnits); } catch {}
  const durationValid = validRewardDays(Number(days)) && (mode !== 'renew' || rewardDeadline(Number(days), reward?.refundAfter).getTime() <= Date.now() + 365 * 86_400_000);
  const op = operation?.operation;
  const prepared = operation?.status === 'prepared';
  const submitted = operation?.status === 'submitted';
  const transactionTitle = (kind: RewardAction) => kind === 'fund' ? t('Revisar depósito') : kind === 'renew' ? t('Revisar renovação') : kind === 'release' ? t('Confirmar devolução e pagar') : t('Cancelar e recuperar');

  if (loading && !data) return <ActivityIndicator color={C.accent} />;
  return <View style={{ gap: 24 }}>
    <RewardSummary reward={reward} amount={amount} currency={initialCurrency} />
    {!!testing && <Notice tone="warning" text={t('Devnet: apenas tokens de teste. Nenhum saldo real será movimentado.')} />}
    {!!error && <Notice error text={error} />}
    {!data && <Button variant="secondary" onPress={() => void load()}>{t('Tentar novamente')}</Button>}
    {data && !data.config && <Notice text={t('Os depósitos de recompensa ainda não estão disponíveis.')} />}
    {data?.config && !data.payer && <Notice text={t('Vincule sua carteira Solana em Minha conta para financiar uma recompensa.')} />}
    {reward?.refundAfter && <Detail label={t('Cancelamento disponível a partir de')} value={date(reward.refundAfter)} />}
    {data?.payer && <Address label={t('Carteira do depósito')} address={data.payer} />}
    {op && (prepared || submitted) ? <>
      <View style={s.divider} />
      <Text style={s.h2}>{prepared ? transactionTitle(op.spec.kind) : t('Confirmando na rede')}</Text>
      <Detail label={t('Valor da recompensa')} value={`${unitsToAmount(op.spec.amountUnits, REWARD_DECIMALS[op.currency])} ${op.currency}`} />
      {op.spec.days && <Detail label={op.spec.kind === 'renew' ? t('Dias adicionais') : t('Prazo da reserva')} value={t('{days} dias', { days: op.spec.days })} />}
      {op.spec.days && <Detail label={t('Cancelamento previsto a partir de')} value={date(rewardDeadline(op.spec.days, op.spec.kind === 'renew' ? reward?.refundAfter : null))} />}
      {op.spec.recipient && <Address label={t('Quem receberá')} address={op.spec.recipient} />}
      <Detail label={t('Taxa da rede')} value={`${unitsToAmount(op.feeLamports, 9)} SOL`} />
      {BigInt(op.rentLamports) > 0n && <Detail label={t('Criação de contas na rede')} value={`${unitsToAmount(op.rentLamports, 9)} SOL`} />}
      {op.spec.kind === 'fund' && <Text style={s.small}>{t('O depósito fica bloqueado até o prazo escolhido. A conta que registra a reserva permanece na rede; seu custo de criação não é devolvido.')}</Text>}
      {op.spec.kind === 'release' && <Notice tone="warning" text={t('Confirme somente se o objeto já estiver com você. O pagamento é definitivo e encerra as conversas deste objeto.')} />}
      {op.spec.kind === 'refund' && <Text style={s.body}>{t('O depósito voltará para a carteira que o financiou. A recompensa deixará de estar reservada.')}</Text>}
      {prepared ? <Button variant={op.spec.kind === 'refund' ? 'warning' : 'success'} icon="check" onPress={() => void approve()} busy={busy} disabled={op.spec.kind === 'release' && (!reportId || !recipient)}>{t('Assinar na carteira')}</Button> : <>
        <Notice text={t('Aguardando confirmação final. Você pode sair desta tela; a reserva só muda depois da confirmação na rede.')} />
        <Button variant="secondary" onPress={() => void retry()} busy={busy} icon="refresh-cw">{t('Verificar transação')}</Button>
      </>}
      {prepared && <Text style={s.small}>{t('Se desistir, volte. O pedido sem assinatura expira automaticamente em poucos minutos.')}</Text>}
      {prepared && op.spec.kind === 'release' && !reportId && <Notice text={t('Retome este pagamento na conversa com quem encontrou.')} />}
    </> : data?.config && data.payer ? <>
      {(!locked || mode === 'renew' && hasReserve) && <>
        <View style={s.divider} />
        <Text style={s.h2}>{locked ? t('Renovar reserva') : t('Reservar uma recompensa')}</Text>
        {!locked && <>
          <View style={s.row}>{data.config.currencies.map(coin => <Button key={coin} variant={currency === coin ? 'primary' : 'secondary'} onPress={() => setCurrency(coin)} disabled={busy} style={{ flex: 1, paddingHorizontal: 12 }}>{coin}</Button>)}</View>
          <Field label={t('Valor da recompensa')} value={value} onChangeText={setValue} editable={!busy} keyboardType="decimal-pad" maxLength={24} placeholder="0" />
          <View style={s.between}><View style={{ flex: 1 }}>{balanceLoading ? <ActivityIndicator color={C.muted} /> : <Text style={s.small}>{t('Disponível: {amount} {currency}', { amount: balance ? unitsToAmount(balance.availableUnits, balance.decimals) : '—', currency })}</Text>}</View><Button variant="ghost" icon="refresh-cw" label={t('Atualizar saldo')} onPress={() => setBalanceRevision(n => n + 1)} disabled={busy || balanceLoading} /></View>
          {!!balanceError && <Notice error text={balanceError} />}
        </>}
        <Field label={locked ? t('Dias adicionais') : t('Prazo da reserva em dias')} value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={3} editable={!busy} help={t('De 1 a 365 dias. A renovação estende o prazo atual, sem retirar o depósito.')} />
        <View style={s.row}>{[7,30,90].map(n => <Button key={n} variant={days === String(n) ? 'primary' : 'secondary'} style={{ flex: 1, paddingHorizontal: 10 }} disabled={busy} onPress={() => setDays(String(n))}>{t('{days} dias', { days: n })}</Button>)}</View>
        {durationValid && <Text style={s.small}>{t('Cancelamento a partir de {date}', { date: date(rewardDeadline(Number(days), locked ? reward?.refundAfter : null)) })}</Text>}
        <Button variant="accent" icon="shield" busy={busy} disabled={!durationValid || !locked && !amountValid} onPress={() => void review(locked ? 'renew' : 'fund')}>{locked ? t('Revisar renovação') : t('Revisar depósito')}</Button>
        {locked && <Button variant="ghost" onPress={() => setMode('fund')} disabled={busy}>{t('Voltar')}</Button>}
      </>}
      {hasReserve && mode !== 'renew' && <>
        {reportId ? <>
          {recipient ? <Address label={t('Carteira de quem encontrou')} address={recipient} /> : <Notice text={t('Quem encontrou precisa confirmar a carteira de recebimento na conversa.')} />}
          <Button variant="success" icon="check-circle" onPress={() => void review('release')} disabled={!recipient} busy={busy}>{t('Confirmar devolução e pagar')}</Button>
        </> : <Text style={s.small}>{t('Para entregar a recompensa, confirme a devolução na conversa com quem encontrou.')}</Text>}
        <Button variant="accent" icon="refresh-cw" onPress={() => { setMode('renew'); setDays('30'); }} disabled={busy}>{t('Renovar reserva')}</Button>
        <Button variant="warning" icon="corner-up-left" onPress={() => void review('refund')} busy={busy} disabled={!reward?.refundAfter || Date.parse(reward.refundAfter) > Date.now()}>{t('Cancelar e recuperar')}</Button>
      </>}
      {reward?.status === 'unverified' && <Notice tone="warning" text={t('Não foi possível confirmar a reserva agora. Aguarde a conexão com a rede antes de continuar.')} />}
      {reward?.status === 'pending' && !operation && <Notice text={t('Confirmando na rede')} />}
    </> : null}
  </View>;
}

function Detail({ label, value }: { label: string; value: string }) {
  const { s } = useUI();
  return <View style={{ gap: 5 }}><Text style={s.small}>{label}</Text><Text style={s.h3}>{value}</Text></View>;
}
export function Address({ label, address }: { label: string; address: string }) {
  const { s, t } = useUI();
  return <View style={s.between}><View style={{ flex: 1, gap: 5 }}><Text style={s.small}>{label}</Text><Text style={[s.body, { color: s.h3.color }]} selectable>{address.slice(0, 8)}…{address.slice(-8)}</Text></View><Button variant="ghost" icon="copy" label={t('Copiar endereço')} onPress={() => { void Clipboard.setStringAsync(address).then(() => ToastAndroid.show(t('Endereço copiado.'), ToastAndroid.SHORT)); }} /></View>;
}
