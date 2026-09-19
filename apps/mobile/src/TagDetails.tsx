import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Linking, Share, StyleSheet, Text, ToastAndroid, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Pressable from './HapticPressable';
import ScreenBottomSheet from './ScreenBottomSheet';
import AccountActionSheet from './AccountActionSheet';
import { Alert } from 'react-native';
import { api, API_URL, Report, Tag, User } from './api';
import { tagCategoryLabel } from './category.model';
import { authenticate, providerNames } from './platform/auth';
import { Button, Field, formatDate, Icon, IconName, Notice, Pill, Sheet, useUI } from './ui';
import { downloadLabel, shareLabel } from './platform/labels';
import { cancelNfcWrite, writeTagUrl } from './platform/nfc';
import RewardSummary, { RewardPendingNotice } from './RewardSummary';
import { rewardAwaitingConfirmation, rewardLocked } from './reward.model';
import { secureStorage } from './platform/storage';
import ConversationReward from './ConversationReward';

type Props = {
  tag: Tag;
  token: string;
  user: User;
  onUserUpdated: (user: User) => void;
  onClose: () => void;
  onUpdated: (tag: Tag) => void;
  onEdit: (tag: Tag, rewardOnly?: boolean) => void;
  onTransferred: () => void;
  onResolved: () => void;
  conversation?: { id: string; status: 'open' | 'resolved' };
};
type Action = 'status' | 'download' | 'sharePdf' | 'share' | 'transfer' | 'nfc' | 'wallet' | null;

export default function TagDetails({ tag, token, user, onUserUpdated, onClose, onUpdated, onEdit, onTransferred, onResolved, conversation }: Props) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const qrSize = Math.max(160, Math.min(270, width - 104));
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState('');
  const [nfcStopping, setNfcStopping] = useState(false);
  const [preview, setPreview] = useState(false);
  const [page, setPage] = useState<'overview' | 'info' | 'transfer'>('overview');
  const [overlay, setOverlay] = useState<'actions' | 'nfc' | null>(null);
  const [pendingStatus, setPendingStatus] = useState<'active' | 'lost' | 'paused' | null>(null);
  const [recipient, setRecipient] = useState('');
  const [password, setPassword] = useState('');
  const [returned, setReturned] = useState(false);
  const [conversationLocked, setConversationLocked] = useState(true);
  const mounted = useRef(true);
  const currentIdentity = useRef(`${tag.id}:${token}`);
  const operation = useRef(0);
  const active = useRef<Action>(null);
  currentIdentity.current = `${tag.id}:${token}`;
  const info = { color: tag.color, icon: (tag.categoryIcon || 'box') as IconName };
  const waiting = rewardAwaitingConfirmation(tag.reward);
  const hasOpenReports = !returned && (tag.openReportCount > 0 || conversation?.status === 'open');
  const returnLocked = rewardLocked(tag.reward) || !!tag.reward?.operation || (!!conversation && conversationLocked);
  const needsWalletForReward = !user.walletAddress && !tag.reward && tag.rewardAmount === 0;
  const latest = useRef({ tag, onUpdated }); latest.current = { tag, onUpdated };

  // The dashboard pauses its polling while details are open. Reconcile this
  // object's pending operation here without refreshing the covered home screen.
  useEffect(() => {
    let live = true; let fetching = false;
    async function refreshReward() {
      if (fetching || AppState.currentState !== 'active') return;
      fetching = true;
      try {
        const result = await api<{ tag: Tag }>(`/tags/${tag.id}`, token);
        const op = result.tag.reward?.operation;
        if (live && op?.status === 'prepared') {
          const signed = await secureStorage.get(`reward-signed-${op.id}`);
          if (live && signed && result.tag.reward) {
            // Recover a submit interrupted before the API received it. Keep the
            // object locked while retrying those same already-signed bytes.
            latest.current.onUpdated({ ...result.tag, reward: { ...result.tag.reward, operation: { ...op, status: 'submitted' } } });
            await api(`/reward-operations/${op.id}/submit`, token, { transaction: signed });
            const updated = await api<{ tag: Tag }>(`/tags/${tag.id}`, token);
            if (live) latest.current.onUpdated(updated.tag);
            return;
          }
        }
        if (live) latest.current.onUpdated(result.tag);
      } catch { /* Keep the last known lock until the API verifies finality. */ }
      finally { fetching = false; }
    }
    void refreshReward();
    const timer = setInterval(() => { if (rewardAwaitingConfirmation(latest.current.tag.reward)) void refreshReward(); }, 5000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refreshReward(); });
    return () => { live = false; clearInterval(timer); subscription.remove(); };
  }, [tag.id, token]);

  useEffect(() => {
    mounted.current = true;
    active.current = null;
    setBusy(null); setError(''); setPage('overview'); setOverlay(null); setPendingStatus(null); setRecipient(''); setPassword(''); setReturned(false); setConversationLocked(true);
    return () => {
      mounted.current = false;
      operation.current++;
      if (active.current === 'nfc') void cancelNfcWrite().catch(() => {});
    };
  }, [tag.id, token]);

  async function run(kind: Exclude<Action, null>, task: () => Promise<() => void>) {
    if (active.current) return;
    const identity = currentIdentity.current;
    const id = ++operation.current;
    const isCurrent = () => mounted.current && operation.current === id && currentIdentity.current === identity;
    active.current = kind; setBusy(kind); setError('');
    try {
      const finish = await task();
      if (isCurrent()) finish();
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.');
    } finally {
      if (isCurrent()) { active.current = null; setBusy(null); }
    }
  }

  function close() {
    if (pendingStatus) { setPendingStatus(null); return; }
    if (overlay) { closeOverlay(); return; }
    if (page !== 'overview') { setPage('overview'); setPassword(''); setError(''); return; }
    operation.current++;
    if (active.current === 'nfc') void cancelNfcWrite().catch(() => {});
    onClose();
  }

  function changeStatus(status: Tag['status']) {
    if (waiting) return;
    if (status === 'active' && tag.status === 'lost' && hasOpenReports && returnLocked) return;
    if (status === 'active' && hasOpenReports && tag.status !== 'paused') {
      if (returnLocked) return;
      void run('status', async () => {
        const reportId = conversation?.status === 'open' ? conversation.id :
          (await api<{ reports: Report[] }>('/reports', token)).reports.find(report => report.tagId === tag.id && report.status === 'open')?.id;
        if (!reportId) {
          const { tag: updated } = await api<{ tag: Tag }>(`/tags/${tag.id}`, token);
          return () => { onUpdated(updated); if (updated.openReportCount === 0) onResolved(); };
        }
        await api(`/reports/${reportId}/resolve`, token, {}, 'POST');
        return () => { finishReturn(); ToastAndroid.show(t('Devolução confirmada.'), ToastAndroid.SHORT); };
      });
      return;
    }
    void run('status', async () => {
      const { tag: updated } = await api<{ tag: Tag }>(`/tags/${tag.id}`, token, { status }, 'PATCH');
      return () => { onUpdated(updated); ToastAndroid.show(t(status === 'lost' ? 'Objeto marcado como perdido.' : status === 'paused' ? 'Objeto arquivado.' : 'Objeto restaurado.'), ToastAndroid.SHORT); };
    });
  }

  function finishReturn() {
    setReturned(true); onResolved();
    const identity = currentIdentity.current;
    void api<{ tag: Tag }>(`/tags/${tag.id}`, token).then(({ tag: updated }) => {
      if (mounted.current && currentIdentity.current === identity) onUpdated(updated);
    }).catch(cause => { if (mounted.current && currentIdentity.current === identity) setError((cause as Error).message); });
  }

  function download() {
    void run('download', async () => {
      const saved = await downloadLabel({ url: `${API_URL}/tags/${tag.id}/label.pdf?lang=${locale.slice(0, 2)}`, token, fileName: `SeekerTag-${tag.code}.pdf` });
      return () => ToastAndroid.show(t(saved ? 'PDF salvo na pasta escolhida.' : 'Download cancelado.'), ToastAndroid.SHORT);
    });
  }

  function sharePdf() {
    void run('sharePdf', async () => {
      await shareLabel({ dialogTitle: t("Compartilhar ou imprimir etiqueta"), url: `${API_URL}/tags/${tag.id}/label.pdf?lang=${locale.slice(0, 2)}`, token, fileName: `SeekerTag-${tag.code}.pdf` });
      return () => {};
    });
  }

  function shareLink() {
    void run('share', async () => {
      await Share.share({ title: `SeekerTag · ${tag.name}`, message: tag.publicUrl, url: tag.publicUrl });
      return () => {};
    });
  }

  function openVisitor() { setError(''); setPreview(true); }

  function writeNfc() {
    if (active.current || nfcStopping) return;
    setOverlay('nfc');
    void run('nfc', async () => {
      await writeTagUrl(tag.publicUrl);
      return () => { setOverlay(null); ToastAndroid.show(t('Etiqueta NFC gravada.'), ToastAndroid.SHORT); };
    });
  }

  async function cancelNfc() {
    if (active.current !== 'nfc') return;
    operation.current++;
    active.current = null;
    setBusy(null);
    setOverlay(null);
    setNfcStopping(true);
    ToastAndroid.show(t('Gravação NFC cancelada.'), ToastAndroid.SHORT);
    await cancelNfcWrite().catch(() => {});
    if (mounted.current) setNfcStopping(false);
  }

  function closeOverlay() {
    if (active.current === 'nfc') { void cancelNfc(); return; }
    setOverlay(null);
    setPendingStatus(null);
    setError('');
  }

  function choose(action: () => void) {
    setOverlay(null);
    setError('');
    action();
  }

  function transfer() {
    if (waiting) return;
    if (!recipient.trim() || recipient.includes('@')) { setError('Use o ID da conta ou a carteira de quem vai receber.'); return; }
    if (user.hasPassword && password.length < 10) { setError('Confirme sua senha atual para transferir o objeto.'); return; }
    void run('transfer', async () => {
      let proof: string | undefined;
      if (!user.hasPassword) {
        const provider = user.providers[0];
        if (!provider) throw new Error('Entre novamente para confirmar sua identidade.');
        const result = await authenticate(provider, 'reauth', token, locale.slice(0, 2));
        if (!result) return () => {};
        if (!result.proof) throw new Error('Não foi possível confirmar sua identidade.');
        proof = result.proof;
      }
      await api<{ ok: true }>(`/tags/${tag.id}/transfer`, token, { recipient: recipient.trim(), ...(proof ? { proof } : { password }) });
      return () => { setPassword(''); onTransferred(); };
    });
  }

  function connectWallet() {
    void run('wallet', async () => {
      const result = await authenticate('solana', 'link', token, locale.slice(0, 2));
      return () => { if (result?.user) onUserUpdated(result.user); };
    });
  }

  const actions = <ScreenBottomSheet title={t("Opções do objeto")} onClose={closeOverlay}>
    <View>
      <ActionRow icon="info" title={t("Detalhes do objeto")} onPress={() => choose(() => setPage('info'))} />
      <ActionRow disabled={waiting} icon="edit-2" title={t("Editar objeto")} onPress={() => choose(() => onEdit(tag))} />
      <ActionRow icon="external-link" title={t("Ver como visitante")} onPress={() => choose(openVisitor)} />
      <ActionRow icon="share-2" title={t("Compartilhar PDF")} onPress={() => choose(sharePdf)} />
      <ActionRow disabled={waiting || (tag.status === 'lost' && hasOpenReports && returnLocked)} tone={tag.status === 'active' ? 'warning' : 'success'} icon={tag.status === 'active' ? 'alert-circle' : 'check-circle'} title={tag.status === 'active' ? t("Marcar como perdido") : tag.status === 'lost' ? t("Já está comigo") : t("Restaurar objeto")} onPress={() => choose(() => setPendingStatus(tag.status === 'active' ? 'lost' : 'active'))} />
      {tag.status !== 'paused' && <ActionRow disabled={waiting} tone="warning" icon="archive" title={t("Arquivar objeto")} onPress={() => choose(() => setPendingStatus('paused'))} />}
      <ActionRow disabled={waiting} tone="danger" icon="arrow-right-circle" title={t("Transferir objeto")} onPress={() => choose(() => setPage('transfer'))} />
    </View>
  </ScreenBottomSheet>;
  const nfc = <ScreenBottomSheet title={t("Gravar NFC")} onClose={closeOverlay}>
    <View style={styles.nfcContent}>
      <Text style={[s.h2, { textAlign: 'center' }]}>{t("Aproxime a etiqueta NFC")}</Text>
      <Text style={[s.body, { textAlign: 'center' }]}>{t("Encoste uma etiqueta NFC regravável na parte de trás do celular.")}</Text>
      {busy === 'nfc' && <NfcSpinner color={C.accent} label={t('Gravando etiqueta NFC')} />}
    </View>
    {error ? <Notice text={error} error /> : <Text style={[s.small, { textAlign: 'center' }]}>{t("O link gravado na etiqueta será substituído.")}</Text>}
    {busy === 'nfc' ? <Button variant="secondary" onPress={() => void cancelNfc()}>{t("Cancelar gravação")}</Button> : <Button onPress={writeNfc} disabled={nfcStopping}>{t("Tentar novamente")}</Button>}
  </ScreenBottomSheet>;

  const closeTransfer = (dismiss: () => void) => {
    if (recipient || password) Alert.alert(t('Descartar alterações?'), t('As alterações não salvas serão perdidas.'), [
      { text: t('Continuar editando'), style: 'cancel' },
      { text: t('Descartar'), style: 'destructive', onPress: dismiss },
    ]); else dismiss();
  };
  const Frame = conversation ? ContextualDetails : Sheet;
  const InfoFrame = conversation ? AccountActionSheet : Sheet;
  return <Frame title={t('Seu objeto')} onClose={close}
    headerRight={<Button variant="ghost" icon="more-horizontal" label={t('Opções do objeto')} busy={busy === 'status' || busy === 'sharePdf'} disabled={!!busy} onPress={() => setOverlay('actions')} />}
    overlay={<>
      {overlay === 'actions' ? actions : overlay === 'nfc' ? nfc : null}
      {page === 'info' && <InfoFrame title={t('Detalhes do objeto')} onClose={() => setPage('overview')}
        headerRight={<Button variant="ghost" icon="edit-2" label={t('Editar objeto')} disabled={waiting || !!busy} onPress={() => onEdit(tag)} />}>
      <View style={s.between}><Text style={[s.h2, { flex: 1 }]}>{tag.name}</Text><Pill status={tag.status} recoveryCount={tag.recoveryCount} /></View>
      <InfoBlock label={t("Categoria")} value={tagCategoryLabel(tag, t)} />
      <Text style={s.small}>{t("Criada em {date}", { date: formatDate(tag.createdAt, locale) })}</Text>
      {tag.description ? <InfoBlock label={t("Sua anotação particular")} value={tag.description} /> : null}
      {tag.publicMessage ? <InfoBlock label={t("Mensagem na etiqueta")} value={tag.publicMessage} /> : null}
      {tag.rewardAmount > 0 ? <InfoBlock label={t("Valor da recompensa")} value={tag.reward ? `${tag.reward.amount} ${tag.reward.currency}` : `${tag.rewardAmount.toLocaleString(locale)} ${tag.rewardCurrency}`} /> : null}
      {tag.recoveryCount > 0 && <Text style={s.body}>{tag.recoveryCount} {tag.recoveryCount === 1 ? t("devolução") : t("devoluções")}</Text>}
      </InfoFrame>}
      {page === 'transfer' && <AccountActionSheet title={t('Transferir objeto')} busy={busy === 'transfer'} guardClose={closeTransfer} onClose={() => { setPage('overview'); setRecipient(''); setPassword(''); setError(''); }}>
      <Text style={s.h2}>{tag.name}</Text>
      <Text style={s.body}>{t("O objeto sairá da sua conta e o mesmo QR passará para a pessoa abaixo. Ela precisa ter uma conta SeekerTag.")}</Text>
      <Text style={s.small}>{t("Suas conversas antigas continuam privadas. Anotação, mensagem pública e recompensa serão apagadas do objeto. Para recebê-lo de volta, a nova pessoa precisa transferi-lo para você.")}</Text>
      {tag.openReportCount > 0 && <Notice error text={t("Conclua as conversas abertas deste objeto antes de transferi-lo.")} />}
      <Field inSheet label={t("ID da conta ou carteira de quem vai receber")} value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} keyboardType="default" maxLength={64} editable={!busy && !waiting} placeholder={t("ID da conta ou endereço Solana")} />
      {user.hasPassword ? <Field inSheet label={t("Sua senha atual")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy && !waiting} onSubmitEditing={transfer} /> : <Text style={s.small}>{t("Você confirmará sua identidade com {provider} antes da transferência.", { provider: providerNames[user.providers[0]] || t("seu acesso vinculado") })}</Text>}
      <Button variant="danger" icon="arrow-right" onPress={transfer} busy={busy === 'transfer'} disabled={!!busy || waiting || tag.openReportCount > 0 || !recipient.trim() || (user.hasPassword && password.length < 10)}>{t("Confirmar transferência")}</Button>
        {!!error && <Notice text={error} error />}
      </AccountActionSheet>}
      {preview && <AccountActionSheet title={t('Prévia do objeto')} titleStyle={styles.previewHeader} onClose={() => setPreview(false)}>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={styles.previewTitle}>{tag.name}</Text>
          <View style={s.row}><Icon name={info.icon} size={16} color={C.muted} /><Text style={s.small}>{tagCategoryLabel(tag, t)}</Text></View>
        </View>
        {!!tag.publicMessage && <View style={[s.card, { gap: 8 }]}><Text style={s.label}>{t('Mensagem do dono')}</Text><Text style={s.body}>{tag.publicMessage}</Text></View>}
        {(tag.reward || tag.rewardAmount > 0) && <RewardSummary reward={tag.reward} amount={tag.rewardAmount} currency={tag.rewardCurrency} />}
      </AccountActionSheet>}
    {pendingStatus && <ScreenBottomSheet title="" onClose={() => setPendingStatus(null)}>
      <View style={{ gap: 28 }}>
        <View style={{ alignItems: 'center', gap: 20 }}>
          <View style={[s.circle, { backgroundColor: pendingStatus === 'active' ? C.greenSoft : C.amberSoft }]}>
            <Icon name={pendingStatus === 'lost' ? 'alert-circle' : pendingStatus === 'paused' ? 'archive' : 'check-circle'} size={28} color={pendingStatus === 'active' ? C.green : C.amber} />
          </View>
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={[s.h2, styles.center]}>{t(pendingStatus === 'lost' ? 'Marcar este objeto como perdido?' : pendingStatus === 'paused' ? 'Arquivar este objeto?' : hasOpenReports && tag.status !== 'paused' ? 'Confirmar devolução?' : 'Restaurar este objeto?')}</Text>
            {pendingStatus === 'lost' && <Text style={[s.body, styles.center]}>{t('Seu objeto aparecerá como perdido. Quem escanear a etiqueta poderá entrar em contato com você pelo app.')}</Text>}
            {pendingStatus === 'active' && hasOpenReports && tag.status !== 'paused' && <Text style={[s.body, styles.center]}>{t('Confirme somente se o objeto já estiver com você. Isso encerra as conversas deste objeto.')}</Text>}
            {pendingStatus === 'paused' && <Text style={[s.body, styles.center]}>{t('Ele sairá das listas principais. O QR e o NFC deixarão de receber novos avisos e mensagens, mas você poderá restaurá-lo depois.')}</Text>}
          </View>
        </View>
        <View style={{ gap: 12 }}>
          <Button variant={pendingStatus === 'active' ? 'success' : 'warning'} icon={pendingStatus === 'lost' ? 'alert-circle' : pendingStatus === 'paused' ? 'archive' : 'check'} busy={busy === 'status'} disabled={!!busy} onPress={() => { const next = pendingStatus; setPendingStatus(null); changeStatus(next); }}>{t(pendingStatus === 'lost' ? 'Marcar como perdido' : pendingStatus === 'paused' ? 'Arquivar objeto' : hasOpenReports && tag.status !== 'paused' ? 'Confirmar devolução' : 'Restaurar objeto')}</Button>
          <Button variant="ghost" disabled={!!busy} onPress={() => setPendingStatus(null)}>{t('Cancelar')}</Button>
        </View>
      </View>
    </ScreenBottomSheet>}
    </>}>
    {waiting && <RewardPendingNotice />}
      <View style={styles.qrCard}>
        <Text accessibilityRole="header" style={[s.h2, styles.center]}>{tag.name}</Text>
        <View style={styles.metadata}><Icon name={info.icon} color={C.muted} size={18} /><Text style={s.small}>{tagCategoryLabel(tag, t)}</Text><Pill status={tag.status} recoveryCount={tag.recoveryCount} /></View>
        <View style={styles.qrPaper}><QRCode value={tag.publicUrl} size={qrSize} backgroundColor="white" color="#101918" ecl="M" quietZone={12} /></View>
        <Text style={[s.small, styles.center]}>{t("Escaneie para abrir a página deste objeto.")}</Text>
      </View>
      <View style={styles.buttonRow}>
        <QrAction icon="download" label={t("Baixar PDF")} onPress={download} busy={busy === 'download'} disabled={!!busy} />
        <QrAction icon="wifi" label={t("Gravar NFC")} onPress={writeNfc} disabled={!!busy || nfcStopping} />
        <QrAction icon="share-2" label={t("Compartilhar")} accessibilityLabel={t("Compartilhar link")} onPress={shareLink} busy={busy === 'share'} disabled={!!busy} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t(needsWalletForReward ? 'Conecte sua carteira para adicionar uma recompensa' : 'Recompensa')} accessibilityState={{ disabled: waiting || !!busy }} disabled={waiting || !!busy} onPress={() => { if (needsWalletForReward) connectWallet(); else onEdit(tag, true); }} style={[s.between, s.card]}>
        {needsWalletForReward ? <View style={[s.row, { flex: 1 }]}><View style={s.settingsIcon}><Icon name="credit-card" size={20} color={C.accent} /></View><View style={{ flex: 1, gap: 5 }}><Text style={s.h3}>{t('Conecte sua carteira para adicionar uma recompensa')}</Text><Text style={s.small}>{t('A recompensa fica reservada na sua carteira Solana até a devolução do objeto.')}</Text></View></View> : <RewardSummary reward={tag.reward} amount={tag.rewardAmount} currency={tag.rewardCurrency} />}
        <Icon name={busy === 'wallet' ? 'loader' : waiting ? 'lock' : 'chevron-right'} size={20} color={waiting ? C.amber : C.muted} />
      </Pressable>
      {conversation && <ConversationReward key={conversation.id} id={conversation.id} token={token} finder={false} open={!returned && conversation.status === 'open'} showSummary={false} onLocked={setConversationLocked} onReleased={finishReturn} />}
      {hasOpenReports && returnLocked && !conversation && <Notice text={t('Para entregar a recompensa, confirme a devolução na conversa com quem encontrou.')} />}
      {tag.status === 'paused' ? <View style={{ gap: 12 }}><Notice tone="warning" text={t("Este objeto está arquivado. O QR e o NFC não recebem novos avisos ou mensagens até você restaurá-lo.")} /><Button variant="success" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy || waiting} icon="rotate-ccw">{t("Restaurar objeto")}</Button></View> : hasOpenReports && !returnLocked ? <Button variant="success" onPress={() => setPendingStatus('active')} busy={busy === 'status'} disabled={!!busy || waiting} icon="check-circle">{t('Finalizar devolução')}</Button> : tag.status === 'lost' ? <Button variant="success" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy || waiting || (hasOpenReports && returnLocked)} icon="check-circle">{t("Já está comigo")}</Button> : null}
      {returned && <Notice tone="success" text={t('Devolução confirmada.')} />}
    {!!error && !overlay && page === 'overview' && <Notice text={error} error />}
  </Frame>;
}

function ContextualDetails({ overlay, children, ...props }: React.ComponentProps<typeof Sheet>) {
  return <AccountActionSheet title={props.title} onClose={props.onClose} headerRight={props.headerRight}>{children}{overlay}</AccountActionSheet>;
}


function QrAction({ icon, label, accessibilityLabel, onPress, busy = false, disabled = false }: { icon: IconName; label: string; accessibilityLabel?: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const { C } = useUI();
  const styles = useThemedStyles(makeStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.qrAction, { opacity: pressed || (disabled && !busy) ? 0.5 : 1 }]}>
    {busy ? <ActivityIndicator color={C.accent} /> : <Icon name={icon} size={24} color={C.accent} />}
    <Text style={styles.qrActionLabel}>{label}</Text>
  </Pressable>;
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  const { s } = useUI();
  return <View style={{ gap: 8 }}><Text style={s.label}>{label}</Text><Text style={[s.body, { color: s.h3.color }]}>{value}</Text></View>;
}

function NfcSpinner({ color, label }: { color: string; label: string }) {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 850, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [rotation]);
  return <Animated.View accessibilityLabel={label} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 4, borderColor: `${color}33`, borderTopColor: color, borderRightColor: color, transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />;
}

function ActionRow({ icon, title, onPress, tone, disabled = false }: { icon: IconName; title: string; onPress: () => void; tone?: 'success' | 'warning' | 'danger'; disabled?: boolean }) {
  const { C, s } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [color, backgroundColor] = tone === 'success' ? [C.green, C.greenSoft] : tone === 'warning' ? [C.amber, C.amberSoft] : tone === 'danger' ? [C.red, C.redSoft] : [C.ink, C.raised];
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionRow, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
    <View style={[s.settingsIcon, { backgroundColor }]}><Icon name={icon} size={20} color={color} /></View><Text style={[s.h3, { flex: 1, fontSize: 18, color }]}>{title}</Text>
  </Pressable>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  previewHeader: { color: C.muted, fontSize: 18, fontWeight: '500', lineHeight: 24, letterSpacing: 0 },
  previewTitle: { color: C.ink, fontSize: 28, fontWeight: '600', lineHeight: 34, letterSpacing: -0.4 },
  center: { textAlign: 'center' },
  metadata: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10 },
  qrCard: { paddingTop: 12, alignItems: 'center', gap: 20 },
  qrPaper: { backgroundColor: 'white', padding: 12, borderRadius: 20, marginTop: 8 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  qrAction: { flex: 1, minHeight: 84, paddingHorizontal: 8, paddingVertical: 14, borderRadius: 20, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', gap: 9 },
  qrActionLabel: { color: C.ink, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  nfcContent: { alignItems: 'center', gap: 24, paddingVertical: 24 },
});
