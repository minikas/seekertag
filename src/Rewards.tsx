import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { api, API_URL, Tag } from './api';
import { Button, C, Field, Icon, Notice, s } from './ui';
import { connectWallet, sendWalletTransaction, signWalletMessage } from './platform/wallet';
import { WalletConnection } from './platform/wallet.types';
import { rewardBaseUnits, rewardDeploymentReady, RewardExpectation, validateRewardTransaction } from './reward-transaction';
import type { PreparedReward, Reward, RewardAction, RewardConfig, RewardResult } from './rewards.types';

function useReward(path: string, token?: string) {
  const identity = `${path}:${token || ''}`;
  const current = useRef(identity); current.current = identity;
  const mounted = useRef(true);
  const request = useRef(0);
  const [config, setConfig] = useState<RewardConfig | null>(null);
  const [data, setData] = useState<RewardResult>({ reward: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const valid = useCallback(() => mounted.current && current.current === identity, [identity]);
  const refresh = useCallback(async (sync = false, signature?: string) => {
    const sequence = ++request.current;
    try {
      const result = await api<RewardResult>(sync ? `${path}/sync` : path, token, sync ? (signature ? { signature } : {}) : undefined);
      if (valid() && sequence === request.current) { setData(result); setError(''); }
      return result;
    } catch (cause) {
      if (valid() && sequence === request.current) { setError((cause as Error).message); setData(old => ({ ...old, canResolve: false, reward: old.reward ? { ...old.reward, status: 'unavailable' } : null })); }
      throw cause;
    }
  }, [path, token, valid]);
  const load = useCallback(async () => {
    try {
      const result = await api<RewardConfig>('/rewards/config');
      if (!valid()) return;
      setConfig(result);
      // Historical deposits still need a fail-closed view when new deposits are disabled.
      await refresh();
    } catch (cause) { if (valid()) setError((cause as Error).message); }
    finally { if (valid()) setLoading(false); }
  }, [refresh, valid]);
  useEffect(() => {
    mounted.current = true; setConfig(null); setData({ reward: null }); setLoading(true); setError('');
    void load();
    return () => { mounted.current = false; };
  }, [load]);
  useEffect(() => {
    if (!config?.enabled) return;
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [config?.enabled, refresh]);
  return { config, data, loading, error, refresh, load, valid };
}

function Pledge({ tag }: { tag?: Tag }) {
  if (!tag || tag.rewardAmount <= 0) return null;
  return <View style={{ padding: 15, borderRadius: 12, backgroundColor: C.amberSoft, gap: 8 }}><View style={s.row}><Icon name="gift" color={C.amber} size={18} /><Text style={[s.label, { color: C.amber }]}>{tag.rewardAmount.toLocaleString('pt-BR')} {tag.rewardCurrency} de recompensa oferecida</Text></View><Text style={s.small}>Promessa do dono, combinada na conversa. Esta promessa não comprova um depósito.</Text></View>;
}

function RewardProof({ reward }: { reward: Reward }) {
  const label = { draft: 'Depósito aguardando confirmação', funded: 'Saldo depositado confirmado', committed: 'Compromisso confirmado', expired: 'Depósito vencido', paid: 'Recompensa paga', refunded: 'Saldo reembolsado ao dono', unavailable: 'Saldo sem verificação disponível' }[reward.status];
  const [linkError, setLinkError] = useState('');
  const expired = reward.status === 'funded' && Date.parse(reward.expiresAt) <= Date.now();
  const currentLabel = expired ? 'Prazo encerrado — atualize a confirmação' : label;
  return <View style={{ gap: 9 }}>
    <View style={s.row}><Icon name={(reward.status === 'funded' && !expired || reward.status === 'committed') ? 'lock' : 'gift'} color={C.purple} size={18} /><Text style={[s.label, { flex: 1 }]}>{currentLabel}</Text></View>
    <Text style={s.h3}>{reward.amount} {reward.assetLabel}</Text>
    {reward.cluster !== 'mainnet-beta' ? <Text style={[s.label, { color: C.amber }]}>Rede de testes ({reward.cluster}) · token de teste, sem SKR real</Text> : null}
    <Text style={s.small}>{reward.status === 'committed' ? 'Validade original da oferta (não encerra o compromisso)' : 'Validade da oferta'}: {new Date(reward.expiresAt).toLocaleString('pt-BR')}</Text>
    {reward.status === 'funded' && !expired ? <Text style={s.small}>Esta oferta ainda não está vinculada a uma devolução. Escanear a etiqueta ou comprovar uma carteira não cria o compromisso. Combine o vínculo com o dono antes de entregar o objeto.</Text> : null}
    {reward.status === 'committed' ? <><Text style={s.small}>O valor está vinculado a uma carteira. O dono não pode trocar o destinatário, renovar nem retirar o depósito. Para pagar, ele ainda precisa assinar a liberação.</Text><Text style={s.small}>O compromisso não expira automaticamente. Sem pagamento ou renúncia voluntária de quem recebe, um impasse pode manter o saldo bloqueado. O contrato não verifica a devolução física.</Text></> : null}
    {reward.status === 'draft' ? <Text style={s.small}>Ainda não há reserva confirmada. Uma assinatura enviada pode levar alguns instantes para aparecer.</Text> : null}
    {reward.status === 'expired' ? <Text style={s.small}>O dono pode renovar ou retirar o saldo. É preciso renovar a oferta antes de assumir um novo compromisso.</Text> : null}
    {reward.status === 'unavailable' ? <Text style={s.small}>Não foi possível verificar a blockchain. Não considere este valor confirmado ou disponível para pagamento.</Text> : null}
    {reward.explorerUrl && /^https:\/\/explorer\.solana\.com\//.test(reward.explorerUrl) ? <Button variant="ghost" icon="external-link" onPress={() => { setLinkError(''); void Linking.openURL(reward.explorerUrl!).catch(() => setLinkError('Não foi possível abrir o comprovante.')); }}>Ver comprovante na blockchain</Button> : null}
    {linkError ? <Notice error text={linkError} /> : null}
  </View>;
}

export function PublicReward({ tag }: { tag: Tag }) {
  const state = useReward(`/public/tags/${encodeURIComponent(tag.code)}/reward`);
  if (state.data.reward) return <View style={[s.card, { padding: 17 }]}><RewardProof reward={state.data.reward} /></View>;
  return <><Pledge tag={tag} />{state.config?.enabled && state.error ? <Text style={s.small}>Não foi possível verificar uma reserva na blockchain.</Text> : null}</>;
}

type Props = { tag?: Tag; reportId?: string; token: string; finder?: boolean; closed?: boolean; onCanResolve?: (ready: boolean) => void };
export function RewardControls({ tag, reportId, token, finder = false, closed = false, onCanResolve }: Props) {
  const path = reportId ? `${finder ? '/finder' : ''}/reports/${reportId}/reward` : `/tags/${tag!.id}/reward`;
  const state = useReward(path, token);
  const { config, data, loading } = state;
  const reward = data.reward;
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [amount, setAmount] = useState(''); const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ prepared: PreparedReward; expected: RewardExpectation } | null>(null);
  const [waiveAck, setWaiveAck] = useState('');
  const [signature, setSignature] = useState<{ rewardId: string; signature: string }>();
  const currentSignature = signature?.rewardId === reward?.id ? signature?.signature : undefined;
  useEffect(() => { setWallet(null); setPreview(null); setWaiveAck(''); setSignature(undefined); setAmount(''); setDays(30); setError(''); setNotice(''); setBusy(false); lock.current = false; }, [path, token]);
  useEffect(() => { onCanResolve?.(!loading && !state.error && ((config?.enabled === false && !data.reward) || data.canResolve === true)); }, [loading, state.error, config?.enabled, data.canResolve, data.reward, onCanResolve]);

  async function run(task: (check: () => void) => Promise<void>) {
    if (lock.current) return;
    const valid = state.valid;
    const check = () => { if (!valid()) throw new Error('Esta conversa ou etiqueta foi fechada.'); };
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(check); }
    catch (cause) { if (valid()) setError(cause instanceof Error ? cause.message : 'Não foi possível concluir. Atualize a confirmação antes de tentar novamente.'); }
    finally { if (valid()) { lock.current = false; setBusy(false); } }
  }
  function refresh() { void run(async check => { setPreview(null); const result = config?.enabled ? await state.refresh(true, currentSignature) : (await state.load(), null); check(); if (result) setNotice(result.reward?.status === 'draft' ? 'Depósito ainda não confirmado. Aguarde e atualize novamente.' : 'Situação consultada na blockchain.'); }); }
  function connect() { void run(async check => { const connected = await connectWallet(config!.cluster); check(); setWallet(connected); setPreview(null); }); }
  function prepare(action: RewardAction) {
    if (!config?.enabled || !wallet) return;
    void run(async check => {
      setPreview(null); setWaiveAck('');
      const fresh = await state.refresh(true, currentSignature); check();
      if (fresh.reward?.status === 'unavailable') throw new Error('Aguarde a verificação da blockchain antes de continuar.');
      if (action === 'fund') rewardBaseUnits(amount);
      if (action !== 'fund' && action !== 'waive' && fresh.reward?.wallet !== wallet.address) throw new Error('Conecte a carteira que depositou esta recompensa.');
      if (action === 'commit' && !fresh.recipient?.wallet) throw new Error('Quem encontrou precisa comprovar a carteira nesta conversa antes do compromisso.');
      if ((action === 'release' || action === 'waive') && (fresh.reward?.status !== 'committed' || fresh.commitmentMatchesReport !== true)) throw new Error('Não há compromisso confirmado para esta conversa. Atualize antes de continuar.');
      if (action === 'waive' && fresh.reward?.recipientWallet !== wallet.address) throw new Error('Somente a carteira vinculada a este compromisso pode renunciar.');
      const expected: RewardExpectation = { action, wallet: wallet.address, amount, days, previous: fresh.reward, recipientWallet: fresh.recipient?.wallet, reportRef: fresh.recipient?.reportRef, commitmentMatchesReport: fresh.commitmentMatchesReport, requestedAt: Date.now() };
      const prepared = await api<PreparedReward>(`${path}/${action === 'fund' ? 'prepare' : action}`, token, { wallet: wallet.address, ...(action === 'fund' ? { amount, days } : action === 'renew' ? { days } : {}) }); check();
      validateRewardTransaction(prepared, config, expected);
      if (prepared.reward.id !== fresh.reward?.id) setSignature(undefined);
      setPreview({ prepared, expected });
    });
  }
  function sign() {
    if (!preview || !config || !wallet || (preview.prepared.action === 'waive' && waiveAck !== 'RENUNCIAR')) return;
    const { prepared, expected } = preview;
    void run(async check => {
      // This is the only path to a wallet transaction request; a preview is never auto-signed.
      const fresh = await state.refresh(true, currentSignature); check();
      const latestExpected = { ...expected, previous: fresh.reward, recipientWallet: fresh.recipient?.wallet, reportRef: fresh.recipient?.reportRef, commitmentMatchesReport: fresh.commitmentMatchesReport };
      // The selected recipient/reference cannot change while the user reviews the preview.
      if (['commit', 'release', 'waive'].includes(expected.action) && (latestExpected.recipientWallet !== expected.recipientWallet || latestExpected.reportRef !== expected.reportRef)) throw new Error('A carteira desta conversa mudou. Revise o compromisso novamente.');
      const transaction = validateRewardTransaction(prepared, config, latestExpected); check();
      setPreview(null);
      let submitted: string;
      try { submitted = await sendWalletTransaction(transaction, expected.wallet, config.cluster); }
      catch (cause) { throw new Error(`${(cause as Error).message || 'A carteira não confirmou o envio.'} Atualize a confirmação antes de tentar novamente; o envio pode já ter ocorrido.`); }
      check(); setSignature({ rewardId: prepared.reward.id, signature: submitted }); setNotice('Transação enviada. Aguardando confirmação da blockchain; não repita o pagamento.');
      const result = await state.refresh(true, submitted); check();
      if (prepared.action === 'release' && result.reward?.status === 'paid' && result.canResolve) setNotice('Pagamento confirmado na blockchain. Você já pode confirmar a devolução nesta conversa.');
      else if (prepared.action === 'commit' && result.reward?.status === 'committed' && result.commitmentMatchesReport && BigInt(result.reward.claimSeq) === BigInt(prepared.intent.claimSeq) + 1n) setNotice('Compromisso confirmado nesta conversa. O destinatário está fixo; o pagamento ainda depende da assinatura do dono.');
      else if (prepared.action === 'waive' && result.reward && ['funded', 'expired'].includes(result.reward.status) && result.reward.claimSeq === prepared.intent.claimSeq) setNotice('Renúncia confirmada sem pagamento. A oferta voltou a ficar livre; se estiver vencida, o dono já pode retirar o saldo.');
      else if (prepared.action === 'refund' && result.reward?.status === 'refunded') setNotice('Reembolso confirmado na blockchain. O QR continua o mesmo.');
      else if ((prepared.action === 'fund' || prepared.action === 'renew') && result.reward?.status === 'funded' && Date.parse(result.reward.expiresAt) >= Number(prepared.intent.expiresAt) * 1000) setNotice('Saldo e validade confirmados na blockchain. O QR continua o mesmo.');
    });
  }
  function proveWallet() {
    if (!config || !wallet) return;
    void run(async check => {
      const fresh = await state.refresh(); check();
      if (!fresh.reward) throw new Error('Não há uma recompensa para receber nesta conversa.');
      if (fresh.reward.status === 'committed') throw new Error('A carteira não pode ser alterada enquanto houver um compromisso ativo.');
      const challenge = await api<{ message: string; nonce: string }>(`${path}/wallet/challenge`, token, { wallet: wallet.address }); check();
      const domain = new URL(process.env.EXPO_PUBLIC_APP_ORIGIN || API_URL).origin;
      const prefix = `SeekerTag finder wallet verification\nDomain: ${domain}\nReport: ${reportId}\nReward: ${fresh.reward.address}\nNetwork: ${config.cluster}\nWallet: ${wallet.address}\nNonce: ${challenge.nonce}\nExpires: `;
      const suffix = '\nThis signature proves wallet ownership. It does not transfer tokens.';
      const expires = challenge.message.startsWith(prefix) && challenge.message.endsWith(suffix) ? Date.parse(challenge.message.slice(prefix.length, -suffix.length)) : NaN;
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce) || !Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 360000) throw new Error('Desafio de assinatura inválido para esta conversa.');
      const signed = await signWalletMessage(challenge.message, wallet.address, config.cluster); check();
      await api(`${path}/wallet/verify`, token, { wallet: wallet.address, nonce: challenge.nonce, signature: signed }); check();
      await state.refresh(); check(); setNotice('Carteira comprovada. Isso ainda não cria um compromisso: aguarde o dono vincular a recompensa antes da entrega.');
    });
  }
  function cancel() {
    if (!wallet) return;
    void run(async check => { await state.refresh(true, currentSignature); check(); await api(`${path}/cancel`, token, { wallet: wallet.address }); check(); await state.refresh(); check(); setNotice('Depósito não realizado cancelado. O QR continua o mesmo.'); });
  }

  if (!loading && !state.error && config?.enabled === false && !reward) return tag ? <Pledge tag={tag} /> : null;
  if (loading) return <View style={s.row}><ActivityIndicator color={C.purple} /><Text style={s.small}>Verificando recompensas…</Text></View>;
  if (!config) return <View style={{ gap: 10 }}><Notice error text="Não foi possível verificar as recompensas. Atualize antes de confirmar a devolução." /><Button variant="ghost" onPress={refresh} busy={busy}>Atualizar recompensas</Button></View>;
  const deploymentReady = rewardDeploymentReady(config);
  const liveReward = reward && ['draft', 'funded', 'committed', 'expired', 'unavailable'].includes(reward.status);
  const fundingWallet = !liveReward || reward.wallet === wallet?.address;
  const canFund = !reportId && !liveReward;
  const canRenew = !reportId && reward && ['funded', 'expired'].includes(reward.status);
  const sameCommitment = reward?.status === 'committed' && data.commitmentMatchesReport === true;
  const canCommit = reportId && !finder && !closed && reward?.status === 'funded' && Date.parse(reward.expiresAt) > Date.now();
  const canRelease = reportId && !finder && !closed && sameCommitment;
  const canWaive = reportId && finder && !closed && sameCommitment;
  return <View style={[s.card, { padding: 18, gap: 14 }]}>
    <Text style={s.h3}>Recompensa com depósito</Text>
    {reward ? <RewardProof reward={reward} /> : <><Pledge tag={tag} /><Text style={s.small}>Deposite tokens no contrato para oferecer uma recompensa verificável. A liberação é autorizada pelo dono.</Text></>}
    {!reward && config.cluster !== 'mainnet-beta' ? <Text style={[s.label, { color: C.amber }]}>Rede de testes ({config.cluster}) · token de teste, sem SKR real</Text> : null}
    <Text style={s.small}>Selecione a rede {config.cluster} na sua carteira.</Text>
    <Text style={s.small}>Carteiras e transferências são públicas. E-mail e telefone continuam privados. A carteira paga taxas de rede e criação de contas em SOL.</Text>
    {config.enabled && !deploymentReady ? <Notice error text="Depósitos e pagamentos estão indisponíveis nesta versão do app para esta rede. Suas etiquetas e conversas continuam funcionando." /> : null}
    {!!(state.error || error) && <Notice error text={error || state.error} />}
    {!!notice && <Notice text={notice} />}
    {reportId && reward?.status === 'committed' && !sameCommitment ? <Notice text="Esta recompensa está vinculada a outra conversa. Você pode continuar conversando, mas esta conversa não tem direito a esse pagamento." /> : null}
    {reportId && sameCommitment ? <Notice text="Compromisso vinculado a esta conversa. Confiram o pagamento confirmado na rede ao combinar a entrega; o vínculo não transfere os tokens automaticamente." /> : null}
    {!reportId && reward?.status === 'committed' ? <Text style={s.small}>Abra a conversa vinculada para liberar o pagamento. O QR continua igual e o vencimento da oferta não libera este saldo para retirada.</Text> : null}
    <Button variant="ghost" icon="refresh-cw" onPress={refresh} disabled={busy}>Atualizar confirmação</Button>
    {config.enabled && deploymentReady && !closed && (!reportId || !!reward) && <>
      {wallet ? <><Text selectable style={s.small}>Carteira conectada: {wallet.address}</Text><Button variant="ghost" onPress={connect} disabled={busy}>Trocar carteira</Button></> : <Button variant="secondary" icon="link" onPress={connect} disabled={busy}>Conectar carteira para recompensa</Button>}
      {wallet && !fundingWallet && !finder ? <Notice error text="Conecte a carteira que fez o depósito para renovar, pagar ou retirar esta recompensa." /> : null}
      {finder ? <>
        {data.recipient?.wallet ? <View style={{ gap: 5 }}><Text style={s.label}>Carteira comprovada para receber</Text><Text selectable style={s.small}>{data.recipient.wallet}</Text></View> : <Text style={s.small}>Conversar não exige carteira. Para receber a recompensa, conecte e assine uma mensagem comprovando seu endereço.</Text>}
        {wallet && reward?.status !== 'committed' ? <Button variant="secondary" onPress={proveWallet} disabled={busy || !!preview}>Comprovar carteira nesta conversa</Button> : null}
        {canWaive ? <><Text style={s.small}>Renunciar é voluntário e não recebe a recompensa. Se você já entregou o objeto e espera o pagamento, mantenha o compromisso.</Text><Button variant="danger" onPress={() => prepare('waive')} disabled={busy || !!preview || wallet?.address !== reward?.recipientWallet}>Revisar renúncia sem pagamento</Button>{wallet && wallet.address !== reward?.recipientWallet ? <Text style={s.small}>Conecte a carteira vinculada para renunciar. A taxa da transação será paga por ela em SOL.</Text> : null}</> : null}
      </> : wallet && fundingWallet ? <>
        {(canFund || (!reportId && reward?.status === 'draft')) && <Field label={`Valor do depósito (${config.assetLabel})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoCapitalize="none" placeholder="100" maxLength={22} editable={!busy && !preview} help="Use ponto para decimais. O valor fica fixo enquanto o depósito estiver ativo." />}
        {(canFund || canRenew || (!reportId && reward?.status === 'draft')) && <View style={{ gap: 9 }}><Text style={s.label}>{canRenew ? 'Estender validade, mantendo o QR' : 'Prazo da recompensa'}</Text><View style={[s.row, { flexWrap: 'wrap' }]}>{[7, 15, 30].map(value => <Button key={value} variant={days === value ? 'primary' : 'secondary'} disabled={busy || !!preview} onPress={() => setDays(value)}>{`${canRenew ? '+' : ''}${value} dias`}</Button>)}</View></View>}
        {(canFund || (!reportId && reward?.status === 'draft')) && <Button onPress={() => prepare('fund')} disabled={busy || !!preview || !amount}>Revisar depósito</Button>}
        {canRenew && <Button onPress={() => prepare('renew')} disabled={busy || !!preview}>Revisar renovação</Button>}
        {!reportId && reward?.status === 'expired' && <Button variant="secondary" onPress={() => prepare('refund')} disabled={busy || !!preview}>Revisar retirada do saldo vencido</Button>}
        {!reportId && reward?.status === 'draft' && <><Button variant="ghost" onPress={cancel} disabled={busy || !!preview}>Cancelar depósito não realizado</Button><Text style={s.small}>O cancelamento só é possível depois que a transação preparada expirar e a rede confirmar que não houve depósito.</Text></>}
        {canCommit && <><Text style={s.small}>{data.recipient?.wallet ? 'Antes da entrega, comprometa este valor com a carteira comprovada nesta conversa. Depois da confirmação, você não poderá trocar o destinatário nem retirar o saldo.' : 'Aguarde esta pessoa comprovar a carteira nesta conversa. Escanear o QR não reserva a recompensa para ela.'}</Text>{data.recipient?.wallet ? <Text selectable style={s.small}>Carteira do compromisso: {data.recipient.wallet}</Text> : null}<Button onPress={() => prepare('commit')} disabled={busy || !!preview || !data.recipient?.wallet}>Comprometer recompensa</Button></>}
        {canRelease && <><Text style={s.small}>Confirme a devolução combinada com esta pessoa e revise o pagamento à carteira já vinculada. O compromisso continua válido mesmo depois do vencimento da oferta.</Text><Text selectable style={s.small}>Quem recebe: {reward?.recipientWallet}</Text><Button onPress={() => prepare('release')} disabled={busy || !!preview}>Recebi o objeto: revisar pagamento</Button></>}
        {reportId && reward?.status === 'expired' ? <Text style={s.small}>Abra os detalhes do objeto e renove a oferta para assumir um compromisso. A etiqueta e o QR continuam iguais.</Text> : null}
      </> : null}
    </>}
    {preview && <View style={{ padding: 16, borderRadius: 13, backgroundColor: C.soft, gap: 12 }}>
      <Text style={s.h3}>Confira antes de assinar</Text>
      <Text style={s.body}>{({ fund: 'Depositar', renew: 'Renovar depósito de', commit: 'Comprometer', release: 'Pagar', waive: 'Renunciar ao compromisso de', refund: 'Retirar' })[preview.prepared.action]} {preview.prepared.reward.amount} {config.assetLabel}</Text>
      <Text style={s.small}>Rede: {config.cluster}</Text>
      {(preview.prepared.action === 'fund' || preview.prepared.action === 'renew') && <Text style={s.small}>Nova validade: {new Date(Number(preview.prepared.intent.expiresAt) * 1000).toLocaleString('pt-BR')}. O QR permanece igual.</Text>}
      {['commit', 'release', 'waive'].includes(preview.prepared.action) && <Text selectable style={s.small}>Destinatário: {preview.expected.recipientWallet}</Text>}
      {preview.prepared.action === 'commit' && <Notice text="Você está fixando esta carteira antes da entrega. Não poderá trocar o destinatário, retirar nem renovar o depósito enquanto houver compromisso. Não há expiração automática; um impasse pode bloquear o saldo. O pagamento ainda exige sua assinatura." />}
      {preview.prepared.action === 'waive' && <><Notice error text="Renúncia voluntária SEM PAGAMENTO: você abre mão deste vínculo e libera a oferta para o dono. Se ela já venceu, ele poderá retirar o saldo. Esta ação não confirma uma devolução nem recebe os tokens. Não renuncie para tentar receber o pagamento." /><Text style={s.small}>Sua carteira vinculada paga a taxa de renúncia em SOL.</Text><Field label="Digite RENUNCIAR para confirmar" value={waiveAck} onChangeText={setWaiveAck} autoCapitalize="characters" autoCorrect={false} editable={!busy} /></>}
      {preview.prepared.action === 'refund' && <Text selectable style={s.small}>Destino do reembolso: {preview.expected.wallet}</Text>}
      <Text style={s.small}>{preview.prepared.action === 'renew' ? 'O mesmo saldo continua no contrato. Não há novo depósito; há taxa de transação em SOL.' : 'A carteira mostrará o pedido de assinatura e as taxas em SOL.'}</Text>
      {preview.prepared.action === 'fund' && <Text style={s.small}>As contas do contrato ficam abertas. O saldo de criação dessas contas em SOL não é devolvido nesta versão.</Text>}
      <Button onPress={sign} busy={busy} disabled={preview.prepared.action === 'waive' && waiveAck !== 'RENUNCIAR'}>{preview.prepared.action === 'waive' ? 'Assinar renúncia sem pagamento' : 'Assinar na carteira'}</Button><Button variant="ghost" onPress={() => setPreview(null)} disabled={busy}>Voltar sem assinar</Button>
    </View>}
    {busy && !preview ? <ActivityIndicator color={C.purple} /> : null}
  </View>;
}
