import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Pressable from './HapticPressable';
import ScreenBottomSheet from './ScreenBottomSheet';
import { nativeTagUrl } from './links';
import { api, API_URL, Tag, User } from './api';
import { tagCategoryLabel, categoryInk } from './category.model';
import { authenticate, providerNames } from './platform/auth';
import { Button, Field, formatDate, Icon, IconName, Notice, Pill, Sheet, useUI } from './ui';
import { downloadLabel, shareLabel } from './platform/labels';
import { cancelNfcWrite, writeTagUrl } from './platform/nfc';
import RewardPanel from './RewardPanel';
import RewardSummary from './RewardSummary';

type Props = {
  tag: Tag;
  token: string;
  user: User;
  onClose: () => void;
  onUpdated: (tag: Tag) => void;
  onEdit: (tag: Tag) => void;
  onTransferred: () => void;
};
type Action = 'status' | 'download' | 'sharePdf' | 'share' | 'transfer' | 'nfc' | null;

export default function TagDetails({ tag, token, user, onClose, onUpdated, onEdit, onTransferred }: Props) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState('');
  const [nfcStopping, setNfcStopping] = useState(false);
  const [page, setPage] = useState<'overview' | 'info' | 'transfer' | 'reward'>('overview');
  const [overlay, setOverlay] = useState<'actions' | 'nfc' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mounted = useRef(true);
  const currentIdentity = useRef(`${tag.id}:${token}`);
  const operation = useRef(0);
  const active = useRef<Action>(null);
  currentIdentity.current = `${tag.id}:${token}`;
  const info = { color: tag.color, icon: (tag.categoryIcon || 'box') as IconName };
  const localOnly = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(tag.publicUrl);

  useEffect(() => {
    mounted.current = true;
    active.current = null;
    setBusy(null); setError(''); setPage('overview'); setOverlay(null); setEmail(''); setPassword('');
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
    if (overlay) { closeOverlay(); return; }
    if (page !== 'overview') { setPage('overview'); setPassword(''); setError(''); return; }
    operation.current++;
    if (active.current === 'nfc') void cancelNfcWrite().catch(() => {});
    onClose();
  }

  function changeStatus(status: Tag['status']) {
    void run('status', async () => {
      const { tag: updated } = await api<{ tag: Tag }>(`/tags/${tag.id}`, token, { status }, 'PATCH');
      return () => { onUpdated(updated); ToastAndroid.show(t(status === 'lost' ? 'Objeto marcado como perdido.' : status === 'paused' ? 'Etiqueta pausada.' : 'Etiqueta ativada.'), ToastAndroid.SHORT); };
    });
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

  function openVisitor() {
    setError('');
    void Linking.openURL(nativeTagUrl(tag.publicUrl)).catch(() => setError('Não foi possível abrir a etiqueta. Use o leitor do aplicativo.'));
  }

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
    setError('');
  }

  function choose(action: () => void) {
    setOverlay(null);
    setError('');
    action();
  }

  function transfer() {
    if (!email.trim()) { setError('Informe o e-mail, a carteira ou o ID da conta que vai receber a etiqueta.'); return; }
    if (user.hasPassword && password.length < 10) { setError('Confirme sua senha atual para transferir a etiqueta.'); return; }
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
      await api<{ ok: true }>(`/tags/${tag.id}/transfer`, token, { recipient: email.trim(), ...(proof ? { proof } : { password }) });
      return () => { setPassword(''); onTransferred(); };
    });
  }

  const actions = <ScreenBottomSheet title={t("Opções do objeto")} onClose={closeOverlay}>
    <View>
      <ActionRow icon="info" title={t("Detalhes do objeto")} onPress={() => choose(() => setPage('info'))} />
      <ActionRow icon="edit-2" title={t("Editar objeto")} onPress={() => choose(() => onEdit(tag))} />
      <ActionRow icon="external-link" title={t("Ver como visitante")} onPress={() => choose(openVisitor)} />
      <ActionRow icon="share-2" title={t("Compartilhar PDF")} onPress={() => choose(sharePdf)} />
      <ActionRow tone={tag.status === 'active' ? 'warning' : 'success'} icon={tag.status === 'active' ? 'alert-circle' : 'check-circle'} title={tag.status === 'active' ? t("Marcar como perdido") : tag.status === 'lost' ? t("Já está comigo") : t("Reativar etiqueta")} onPress={() => choose(() => changeStatus(tag.status === 'active' ? 'lost' : 'active'))} />
      {tag.status !== 'paused' && <ActionRow tone="warning" icon="pause-circle" title={t("Pausar etiqueta")} onPress={() => choose(() => changeStatus('paused'))} />}
      <ActionRow tone="danger" icon="arrow-right-circle" title={t("Transferir etiqueta")} onPress={() => choose(() => setPage('transfer'))} />
    </View>
  </ScreenBottomSheet>;
  const nfc = <ScreenBottomSheet title={t("Gravar NFC")} onClose={closeOverlay}>
    <View style={styles.nfcContent}>
      <View style={styles.nfcIcon}><Icon name="wifi" size={38} /></View>
      <Text style={[s.h2, { textAlign: 'center' }]}>{t("Aproxime a etiqueta NFC")}</Text>
      <Text style={[s.body, { textAlign: 'center' }]}>{t("Encoste uma etiqueta NFC regravável na parte de trás do celular.")}</Text>
      {busy === 'nfc' && <ActivityIndicator color={C.ink} />}
    </View>
    {error ? <Notice text={error} error /> : <Text style={[s.small, { textAlign: 'center' }]}>{t("O link gravado na etiqueta será substituído.")}</Text>}
    {busy === 'nfc' ? <Button variant="secondary" onPress={() => void cancelNfc()}>{t("Cancelar gravação")}</Button> : <Button onPress={writeNfc} disabled={nfcStopping}>{t("Tentar novamente")}</Button>}
  </ScreenBottomSheet>;

  return <Sheet title={page === 'reward' ? t("Recompensa") : page === 'transfer' ? t("Transferir etiqueta") : page === 'info' ? t("Detalhes do objeto") : tag.name} contentKey={page} onClose={close} dismissible={busy !== 'transfer'}
    headerRight={page === 'overview' ? <Button variant="ghost" icon="more-horizontal" label={t("Opções do objeto")} busy={busy === 'status' || busy === 'sharePdf'} disabled={!!busy} onPress={() => setOverlay('actions')} /> : undefined}
    overlay={overlay === 'actions' ? actions : overlay === 'nfc' ? nfc : undefined}>
    {page === 'reward' ? <RewardPanel key={tag.id} tagId={tag.id} token={token} amount={tag.rewardAmount} currency={tag.rewardCurrency} onChanged={reward => onUpdated({ ...tag, reward, ...(reward ? { rewardAmount: Number(reward.amount), rewardCurrency: reward.currency } : {}) })} onCompleted={() => setPage('overview')} /> : page === 'overview' ? <>
      <View style={s.between}>
        <View style={[s.row, { flex: 1 }]}><View style={[styles.itemIcon, { backgroundColor: info.color }]}><Icon name={info.icon} color={categoryInk(info.color)} size={24} /></View><Text style={[s.body, { flex: 1 }]}>{tagCategoryLabel(tag, t)}</Text></View>
        <Pill status={tag.status} />
      </View>
      <View style={styles.qrCard}>
        <View style={styles.qrPaper}><QRCode value={tag.publicUrl} size={210} backgroundColor="white" color="#101918" ecl="M" quietZone={10} /></View>
      </View>
      <View style={styles.buttonRow}>
        <Button style={styles.halfButton} onPress={download} busy={busy === 'download'} disabled={!!busy}>{t("Baixar PDF")}</Button>
        <Button style={styles.halfButton} variant="secondary" onPress={writeNfc} disabled={!!busy || nfcStopping}>{t("Gravar NFC")}</Button>
        <Button variant="secondary" icon="share-2" label={t("Compartilhar link")} onPress={shareLink} busy={busy === 'share'} disabled={!!busy} style={{ width: 58 }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Recompensa")} onPress={() => { setError(''); setPage('reward'); }} style={[s.between, s.card]}><RewardSummary reward={tag.reward} amount={tag.rewardAmount} currency={tag.rewardCurrency} /><Icon name="chevron-right" size={20} color={C.muted} /></Pressable>
      {tag.status === 'paused' ? <View style={{ gap: 12 }}><Notice tone="warning" text={t("O QR está pausado. Reative a etiqueta para receber avisos e mensagens.")} /><Button variant="success" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="play-circle">{t("Reativar etiqueta")}</Button></View> : tag.status === 'lost' ? <Button variant="success" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="check-circle">{t("Já está comigo")}</Button> : null}
      {localOnly && <View style={styles.localNote}><Icon name="info" size={16} color={C.muted} /><Text style={[s.small, { flex: 1 }]}>{t("Link local. Outros aparelhos precisam de um endereço público.")}</Text></View>}
    </> : page === 'info' ? <>
      <View style={s.between}><Text style={[s.h2, { flex: 1 }]}>{tag.name}</Text><Pill status={tag.status} /></View>
      <InfoBlock label={t("Categoria")} value={tagCategoryLabel(tag, t)} />
      <Text style={s.small}>{t("Criada em {date}", { date: formatDate(tag.createdAt, locale) })}</Text>
      {tag.description ? <InfoBlock label={t("Sua anotação particular")} value={tag.description} /> : null}
      {tag.publicMessage ? <InfoBlock label={t("Mensagem na etiqueta")} value={tag.publicMessage} /> : null}
      {tag.rewardAmount > 0 ? <InfoBlock label={t("Valor da recompensa")} value={`${tag.rewardAmount.toLocaleString(locale)} ${tag.rewardCurrency}`} /> : null}
      {tag.recoveryCount > 0 && <Text style={s.body}>{tag.recoveryCount} {tag.recoveryCount === 1 ? t("devolução") : t("devoluções")}</Text>}
      <Button variant="secondary" icon="edit-2" onPress={() => onEdit(tag)}>{t("Editar objeto")}</Button>
    </> : <>
      <Text style={s.h2}>{tag.name}</Text>
      <Text style={s.body}>{t("A etiqueta sairá da sua conta e o mesmo QR passará para a pessoa abaixo. Ela precisa ter uma conta SeekerTag.")}</Text>
      <Text style={s.small}>{t("Suas conversas antigas continuam privadas. Anotação, mensagem pública e recompensa serão apagadas da etiqueta. Para recebê-la de volta, a nova pessoa precisa transferi-la para você.")}</Text>
      {tag.openReportCount > 0 && <Notice error text={t("Conclua as conversas abertas deste objeto antes de transferir a etiqueta.")} />}
      <Field label={t("E-mail, carteira ou ID de quem vai receber")} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy} placeholder={t("E-mail, endereço Solana ou ID da conta")} />
      {user.hasPassword ? <Field label={t("Sua senha atual")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy} onSubmitEditing={transfer} /> : <Text style={s.small}>{t("Você confirmará sua identidade com {provider} antes da transferência.", { provider: providerNames[user.providers[0]] || t("seu acesso vinculado") })}</Text>}
      <Button variant="danger" icon="arrow-right" onPress={transfer} busy={busy === 'transfer'} disabled={!!busy || tag.openReportCount > 0 || !email.trim() || (user.hasPassword && password.length < 10)}>{t("Confirmar transferência")}</Button>
    </>}
    {!!error && overlay !== 'nfc' && <Notice text={error} error />}
  </Sheet>;
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  const { s } = useUI();
  return <View style={{ gap: 8 }}><Text style={s.label}>{label}</Text><Text style={[s.body, { color: s.h3.color }]}>{value}</Text></View>;
}

function ActionRow({ icon, title, onPress, tone }: { icon: IconName; title: string; onPress: () => void; tone?: 'success' | 'warning' | 'danger' }) {
  const { C, s } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [color, backgroundColor] = tone === 'success' ? [C.green, C.greenSoft] : tone === 'warning' ? [C.amber, C.amberSoft] : tone === 'danger' ? [C.red, C.redSoft] : [C.ink, C.raised];
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.65 }]}>
    <View style={[s.settingsIcon, { backgroundColor }]}><Icon name={icon} size={20} color={color} /></View><Text style={[s.h3, { flex: 1, fontSize: 18, color }]}>{title}</Text>
  </Pressable>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  itemIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qrCard: { paddingVertical: 20, alignItems: 'center' },
  qrPaper: { backgroundColor: 'white', padding: 14, borderRadius: 24 },
  localNote: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfButton: { flex: 1, paddingHorizontal: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  nfcContent: { alignItems: 'center', gap: 16, paddingVertical: 12 },
  nfcIcon: { width: 76, height: 76, borderRadius: 26, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
});
