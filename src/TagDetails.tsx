import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { nativeTagUrl } from './links';
import { api, API_URL, Tag, User } from './api';
import { tagCategoryLabel, categoryInk } from './category.model';
import { authenticate, providerNames } from './platform/auth';
import { Button, Field, formatDate, Icon, IconName, Notice, Pill, Sheet, useUI } from './ui';
import { downloadLabel, shareLabel } from './platform/labels';
import { cancelNfcWrite, writeTagUrl } from './platform/nfc';

type Props = {
  tag: Tag;
  token: string;
  user: User;
  onClose: () => void;
  onUpdated: (tag: Tag) => void;
  onEdit: (tag: Tag) => void;
  onTransferred: () => void;
};
type Action = 'status' | 'download' | 'sharePdf' | 'copy' | 'share' | 'transfer' | 'nfc' | null;

export default function TagDetails({ tag, token, user, onClose, onUpdated, onEdit, onTransferred }: Props) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nfcStopping, setNfcStopping] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
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
    setBusy(null); setError(''); setNotice(''); setTransferOpen(false); setEmail(''); setPassword('');
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
    active.current = kind; setBusy(kind); setError(''); setNotice('');
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
    operation.current++;
    if (active.current === 'nfc') void cancelNfcWrite().catch(() => {});
    onClose();
  }

  function changeStatus(status: Tag['status']) {
    void run('status', async () => {
      const { tag: updated } = await api<{ tag: Tag }>(`/tags/${tag.id}`, token, { status }, 'PATCH');
      return () => { onUpdated(updated); setNotice(status === 'lost' ? 'Marcado como perdido. Quem encontrar verá seu aviso.' : status === 'paused' ? 'Etiqueta pausada. O QR não recebe novos avisos até você reativar.' : 'Etiqueta ativa e pronta para receber avisos.'); };
    });
  }

  function download() {
    void run('download', async () => {
      const saved = await downloadLabel({ url: `${API_URL}/tags/${tag.id}/label.pdf?lang=${locale.slice(0, 2)}`, token, fileName: `SeekerTag-${tag.code}.pdf` });
      return () => setNotice(saved ? 'PDF salvo na pasta escolhida. Imprima em tamanho real e teste o QR.' : 'Download cancelado.');
    });
  }

  function sharePdf() {
    void run('sharePdf', async () => {
      await shareLabel({ dialogTitle: t("Compartilhar ou imprimir etiqueta"), url: `${API_URL}/tags/${tag.id}/label.pdf?lang=${locale.slice(0, 2)}`, token, fileName: `SeekerTag-${tag.code}.pdf` });
      return () => {};
    });
  }

  function copyLink() {
    void run('copy', async () => {
      await Clipboard.setStringAsync(tag.publicUrl);
      return () => setNotice('Link da etiqueta copiado.');
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
    void run('nfc', async () => {
      await writeTagUrl(tag.publicUrl);
      return () => setNotice('Etiqueta NFC gravada. Afaste e aproxime novamente para testar o link.');
    });
  }

  async function cancelNfc() {
    if (active.current !== 'nfc') return;
    operation.current++;
    active.current = null;
    setBusy(null);
    setNfcStopping(true);
    ToastAndroid.show(t('Gravação NFC cancelada.'), ToastAndroid.SHORT);
    await cancelNfcWrite().catch(() => {});
    if (mounted.current) setNfcStopping(false);
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

  return <Sheet title={tag.name} subtitle={`${tagCategoryLabel(tag, t)} · ${t("Criada em {date}", { date: formatDate(tag.createdAt, locale) })}`} onClose={close}>
    <View style={s.between}>
      <View style={[s.row, { flex: 1 }]}><View style={[styles.itemIcon, { backgroundColor: info.color }]}><Icon name={info.icon} color={categoryInk(info.color)} size={24} /></View><View style={{ gap: 4, flex: 1 }}><Text style={s.h3}>{t("Sua etiqueta")}</Text></View></View>
      <Pill status={tag.status} />
    </View>

    <View style={styles.qrCard}>
      <View style={styles.qrPaper}><QRCode value={tag.publicUrl} size={190} backgroundColor="white" color="#252925" ecl="M" quietZone={10} /></View>
      <Text style={styles.qrTitle}>{t("Encontrou? Escaneie para devolver.")}</Text>
      <View style={s.row}><Icon name="shield" size={13} color={C.accent} /><Text style={s.small}>{t("Seu e-mail e sua anotação ficam privados.")}</Text></View>
    </View>

    {localOnly ? <View style={styles.localNote}><Icon name="info" size={17} color={C.amber} /><Text style={[s.small, { color: C.amber, flex: 1 }]}>{t("Este link funciona apenas neste computador. Antes de usar a etiqueta em outro celular, defina um endereço acessível pela rede ou pela internet.")}</Text></View> : null}
    {tag.status === 'paused' ? <View style={styles.localNote}><Icon name="pause-circle" size={17} color={C.amber} /><Text style={[s.small, { color: C.amber, flex: 1 }]}>{t("O QR está pausado. Reative a etiqueta para receber avisos e mensagens.")}</Text></View> : null}

    <View style={{ gap: 10 }}>
      <Button onPress={download} busy={busy === 'download'} disabled={!!busy} icon="download">{t("Baixar etiquetas em PDF")}</Button>
      <Button variant="secondary" onPress={sharePdf} busy={busy === 'sharePdf'} disabled={!!busy} icon="share-2">{t("Compartilhar PDF")}</Button>
      <View style={styles.buttonRow}>
        <Button style={styles.halfButton} variant="secondary" onPress={writeNfc} disabled={!!busy || nfcStopping} icon="wifi">{t("Gravar NFC")}</Button>
        <Button style={styles.halfButton} variant="secondary" onPress={openVisitor} disabled={!!busy} icon="external-link">{t("Ver como visitante")}</Button>
      </View>
      {busy === 'nfc' ? <View style={styles.nfcProgress}><View style={[s.row, { alignItems: 'flex-start' }]}><ActivityIndicator color={C.accent} /><View style={{ flex: 1, gap: 4 }}><Text style={s.label}>{t("Aproxime a etiqueta NFC")}</Text><Text style={s.small}>{t("Mantenha uma etiqueta NDEF regravável encostada no aparelho. O link existente será substituído.")}</Text></View></View><Button variant="ghost" onPress={() => void cancelNfc()} icon="x">{t("Cancelar gravação")}</Button></View> : null}
      <Text style={[s.small, { textAlign: 'center' }]}>{t("Imprima, recorte e prenda ao item. NFC é opcional.")}</Text>
    </View>

    <View style={{ gap: 10 }}>
      <Field label={t("Link da etiqueta")} value={tag.publicUrl} editable={false} selectTextOnFocus autoCapitalize="none" style={{ fontSize: 15 }} />
      <Button variant="secondary" icon="copy" onPress={copyLink} busy={busy === 'copy'} disabled={!!busy}>{t("Copiar link")}</Button>
      <Button variant="secondary" icon="share-2" onPress={shareLink} busy={busy === 'share'} disabled={!!busy}>{t("Compartilhar link")}</Button>
    </View>

    {error && !transferOpen ? <Notice text={error} error /> : null}
    {notice ? <Notice text={notice} /> : null}

    <View style={s.divider} />
    <View style={{ gap: 12 }}>
      <View style={s.between}><Text style={s.h3}>{t("Status do objeto")}</Text>{tag.recoveryCount > 0 ? <Text style={s.small}>{tag.recoveryCount} {tag.recoveryCount === 1 ? t("devolução") : t("devoluções")}</Text> : null}</View>
      {tag.status === 'lost' ? <Button variant="secondary" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="check-circle">{t("Já está comigo")}</Button> : tag.status === 'paused' ? <Button onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="play-circle">{t("Reativar etiqueta")}</Button> : <Button variant="secondary" onPress={() => changeStatus('lost')} busy={busy === 'status'} disabled={!!busy} icon="alert-circle">{t("Marcar como perdido")}</Button>}
      <View style={styles.buttonRow}>
        <Button style={styles.halfButton} variant="secondary" icon="edit-2" onPress={() => onEdit(tag)} disabled={!!busy}>{t("Editar objeto")}</Button>
        {tag.status !== 'paused' ? <Button style={styles.halfButton} variant="ghost" icon="pause-circle" onPress={() => changeStatus('paused')} disabled={!!busy}>{t("Pausar etiqueta")}</Button> : null}
      </View>
      {tag.description ? <View style={styles.privateNote}><View style={s.row}><Icon name="lock" size={14} color={C.muted} /><Text style={s.label}>{t("Sua anotação particular")}</Text></View><Text style={s.body}>{tag.description}</Text></View> : null}
      {tag.rewardAmount > 0 ? <View style={styles.privateNote}><View style={s.row}><Icon name="gift" size={15} color={C.accent} /><Text style={s.label}>{tag.rewardAmount.toLocaleString(locale)} {tag.rewardCurrency} {t("de recompensa oferecida")}</Text></View><Text style={s.small}>{t("Promessa do dono. O pagamento é combinado na conversa; nenhum valor foi depositado pelo app.")}</Text></View> : null}
    </View>

    <View style={s.divider} />
    {transferOpen ? <View style={styles.transfer}>
      <Text style={s.h3}>{t("Transferir para outra pessoa")}</Text>
      <Text style={s.body}>{t("A etiqueta sairá da sua conta e o mesmo QR passará para a pessoa abaixo. Ela precisa ter uma conta SeekerTag.")}</Text>
      <Text style={s.small}>{t("Suas conversas antigas continuam privadas. Anotação, mensagem pública e recompensa serão apagadas da etiqueta. Para recebê-la de volta, a nova pessoa precisa transferi-la para você.")}</Text>
      {tag.openReportCount > 0 ? <Notice error text={t("Conclua as conversas abertas deste objeto antes de transferir a etiqueta.")} /> : null}
      <Field label={t("E-mail, carteira ou ID de quem vai receber")} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy} placeholder={t("E-mail, endereço Solana ou ID da conta")} />
      {user.hasPassword ? <Field label={t("Sua senha atual")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy} onSubmitEditing={transfer} /> : <Text style={s.small}>{t("Você confirmará sua identidade com {provider} antes da transferência.", { provider: providerNames[user.providers[0]] || t("seu acesso vinculado") })}</Text>}
      {error ? <Notice text={error} error /> : null}
      <Button variant="danger" icon="arrow-right" onPress={transfer} busy={busy === 'transfer'} disabled={!!busy || tag.openReportCount > 0}>{t("Confirmar transferência")}</Button>
      <Button variant="ghost" onPress={() => { setTransferOpen(false); setPassword(''); setError(''); }} disabled={!!busy}>{t("Cancelar")}</Button>
    </View> : <Button variant="ghost" icon="arrow-right-circle" onPress={() => { setTransferOpen(true); setError(''); setNotice(''); }} disabled={!!busy}>{t("Transferir etiqueta para outra pessoa")}</Button>}
  </Sheet>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  itemIcon: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  qrCard: { paddingVertical: 28, alignItems: 'center', gap: 20 },
  qrPaper: { backgroundColor: 'white', padding: 8 },
  qrTitle: { color: C.ink, fontSize: 20, fontWeight: '500', textAlign: 'center', lineHeight: 27 },
  localNote: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 18, backgroundColor: C.amberSoft, alignItems: 'flex-start' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  halfButton: { flex: 1, minWidth: 165, paddingHorizontal: 12 },
  nfcProgress: { padding: 20, backgroundColor: C.soft, borderRadius: 22, gap: 12 },
  privateNote: { padding: 20, borderRadius: 22, backgroundColor: C.surface, gap: 12 },
  transfer: { padding: 20, borderWidth: 1, borderColor: C.redLine, borderRadius: 24, gap: 18, backgroundColor: C.redSoft },
});
