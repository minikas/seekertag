import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, API_URL, Tag } from './api';
import { Button, C, categoryInfo, Field, formatDate, Icon, Notice, Pill, Sheet, s } from './ui';
import { downloadLabel } from './platform/labels';
import { cancelNfcWrite, writeTagUrl } from './platform/nfc';

type Props = {
  tag: Tag;
  token: string;
  onClose: () => void;
  onUpdated: (tag: Tag) => void;
  onEdit: (tag: Tag) => void;
  onTransferred: () => void;
};
type Action = 'status' | 'download' | 'share' | 'transfer' | 'nfc' | null;

export default function TagDetails({ tag, token, onClose, onUpdated, onEdit, onTransferred }: Props) {
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mounted = useRef(true);
  const currentIdentity = useRef(`${tag.id}:${token}`);
  const operation = useRef(0);
  const active = useRef<Action>(null);
  currentIdentity.current = `${tag.id}:${token}`;
  const info = categoryInfo(tag.category);
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
      await downloadLabel({ url: `${API_URL}/tags/${tag.id}/label.pdf`, token, fileName: `SeekerTag-${tag.code}.pdf` });
      return () => setNotice(Platform.OS === 'web' ? 'PDF baixado. Imprima em tamanho real e teste o QR antes de prender ao objeto.' : 'PDF pronto para salvar, compartilhar ou imprimir.');
    });
  }

  function shareLink() {
    void run('share', async () => {
      if (Platform.OS === 'web') {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Não foi possível copiar automaticamente. Selecione e copie o link no campo abaixo.');
        await globalThis.navigator.clipboard.writeText(tag.publicUrl);
        return () => setNotice('Link da etiqueta copiado.');
      }
      await Share.share({ title: `SeekerTag · ${tag.name}`, message: tag.publicUrl, url: tag.publicUrl });
      return () => {};
    });
  }

  function openPublicPage() {
    setError('');
    if (Platform.OS === 'web') {
      const opened = globalThis.window.open(tag.publicUrl, '_blank', 'noopener,noreferrer');
      // noopener intentionally makes window.open return null in several browsers.
      void opened;
    } else void Linking.openURL(tag.publicUrl).catch(() => setError('Não foi possível abrir o navegador. Copie ou compartilhe o link da etiqueta.'));
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
    await cancelNfcWrite().catch(() => {});
    if (mounted.current) { active.current = null; setBusy(null); setNotice('Gravação NFC cancelada.'); }
  }

  function transfer() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Informe o e-mail da conta que vai receber a etiqueta.'); return; }
    if (password.length < 10) { setError('Confirme sua senha atual para transferir a etiqueta.'); return; }
    void run('transfer', async () => {
      await api<{ ok: true }>(`/tags/${tag.id}/transfer`, token, { email: email.trim().toLowerCase(), password });
      return () => { setPassword(''); onTransferred(); };
    });
  }

  return <Sheet title={tag.name} subtitle={`${tag.category} · Criada em ${formatDate(tag.createdAt)}`} onClose={close}>
    <View style={s.between}>
      <View style={[s.row, { flex: 1 }]}><View style={[styles.itemIcon, { backgroundColor: info.color }]}><Icon name={info.icon} size={24} /></View><View style={{ gap: 4, flex: 1 }}><Text style={s.h3}>Sua etiqueta</Text></View></View>
      <Pill status={tag.status} />
    </View>

    <View style={styles.qrCard}>
      <View style={styles.qrPaper}><QRCode value={tag.publicUrl} size={190} backgroundColor="white" color="#252925" ecl="M" quietZone={10} /></View>
      <Text style={styles.qrTitle}>Encontrou? Escaneie para devolver.</Text>
      <View style={s.row}><Icon name="shield" size={13} color={C.purple} /><Text style={s.small}>Seu e-mail e sua anotação ficam privados.</Text></View>
    </View>

    {localOnly ? <View style={styles.localNote}><Icon name="info" size={17} color={C.amber} /><Text style={[s.small, { color: C.amber, flex: 1 }]}>Este link funciona apenas neste computador. Antes de usar a etiqueta em outro celular, defina um endereço acessível pela rede ou pela internet.</Text></View> : null}
    {tag.status === 'paused' ? <View style={styles.localNote}><Icon name="pause-circle" size={17} color={C.amber} /><Text style={[s.small, { color: C.amber, flex: 1 }]}>O QR está pausado. Reative a etiqueta para receber avisos e mensagens.</Text></View> : null}

    <View style={{ gap: 10 }}>
      <Button onPress={download} busy={busy === 'download'} disabled={!!busy} icon="download">Baixar etiquetas em PDF</Button>
      <View style={styles.buttonRow}>
        <Button style={styles.halfButton} variant="secondary" onPress={writeNfc} disabled={!!busy} icon="wifi">Gravar NFC</Button>
        <Button style={styles.halfButton} variant="secondary" onPress={openPublicPage} disabled={!!busy} icon="external-link">Ver página pública</Button>
      </View>
      {busy === 'nfc' ? <View style={styles.nfcProgress}><View style={[s.row, { alignItems: 'flex-start' }]}><ActivityIndicator color={C.purple} /><View style={{ flex: 1, gap: 4 }}><Text style={s.label}>Aproxime a etiqueta NFC</Text><Text style={s.small}>Mantenha uma etiqueta NDEF regravável encostada no aparelho. O link existente será substituído.</Text></View></View><Button variant="ghost" onPress={() => void cancelNfc()} icon="x">Cancelar gravação</Button></View> : null}
      <Text style={[s.small, { textAlign: 'center' }]}>Imprima, recorte e prenda ao item. NFC é opcional.</Text>
    </View>

    <View style={{ gap: 10 }}>
      <Field label="Link da etiqueta" value={tag.publicUrl} editable={false} selectTextOnFocus autoCapitalize="none" style={{ fontSize: 12 }} />
      <Button variant="secondary" icon={Platform.OS === 'web' ? 'copy' : 'share-2'} onPress={shareLink} busy={busy === 'share'} disabled={!!busy}>{Platform.OS === 'web' ? 'Copiar link' : 'Compartilhar link'}</Button>
    </View>

    {error && !transferOpen ? <Notice text={error} error /> : null}
    {notice ? <Notice text={notice} /> : null}

    <View style={s.divider} />
    <View style={{ gap: 12 }}>
      <View style={s.between}><Text style={s.h3}>Status do objeto</Text>{tag.recoveryCount > 0 ? <Text style={s.small}>{tag.recoveryCount} {tag.recoveryCount === 1 ? 'devolução' : 'devoluções'}</Text> : null}</View>
      {tag.status === 'lost' ? <Button variant="secondary" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="check-circle">Já está comigo</Button> : tag.status === 'paused' ? <Button onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="play-circle">Reativar etiqueta</Button> : <Button variant="secondary" onPress={() => changeStatus('lost')} busy={busy === 'status'} disabled={!!busy} icon="alert-circle">Marcar como perdido</Button>}
      <View style={styles.buttonRow}>
        <Button style={styles.halfButton} variant="secondary" icon="edit-2" onPress={() => onEdit(tag)} disabled={!!busy}>Editar objeto</Button>
        {tag.status !== 'paused' ? <Button style={styles.halfButton} variant="ghost" icon="pause-circle" onPress={() => changeStatus('paused')} disabled={!!busy}>Pausar etiqueta</Button> : null}
      </View>
      {tag.description ? <View style={styles.privateNote}><View style={s.row}><Icon name="lock" size={14} color={C.muted} /><Text style={s.label}>Sua anotação particular</Text></View><Text style={s.body}>{tag.description}</Text></View> : null}
      {tag.rewardAmount > 0 ? <View style={styles.privateNote}><View style={s.row}><Icon name="gift" size={15} color={C.purple} /><Text style={s.label}>{tag.rewardAmount.toLocaleString('pt-BR')} {tag.rewardCurrency} de recompensa oferecida</Text></View><Text style={s.small}>Promessa do dono. O pagamento é combinado na conversa; nenhum valor foi depositado pelo app.</Text></View> : null}
    </View>

    <View style={s.divider} />
    {transferOpen ? <View style={styles.transfer}>
      <Text style={s.h3}>Transferir para outra pessoa</Text>
      <Text style={s.body}>A etiqueta sairá da sua conta e o mesmo QR passará para a pessoa abaixo. Ela precisa ter uma conta SeekerTag.</Text>
      <Text style={s.small}>Suas conversas antigas continuam privadas. Anotação, mensagem pública e recompensa serão apagadas da etiqueta. Para recebê-la de volta, a nova pessoa precisa transferi-la para você.</Text>
      {tag.openReportCount > 0 ? <Notice error text="Conclua as conversas abertas deste objeto antes de transferir a etiqueta." /> : null}
      <Field label="E-mail de quem vai receber" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy} placeholder="pessoa@exemplo.com" />
      <Field label="Sua senha atual" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy} onSubmitEditing={transfer} />
      {error ? <Notice text={error} error /> : null}
      <Button variant="danger" icon="arrow-right" onPress={transfer} busy={busy === 'transfer'} disabled={!!busy || tag.openReportCount > 0}>Confirmar transferência</Button>
      <Button variant="ghost" onPress={() => { setTransferOpen(false); setPassword(''); setError(''); }} disabled={!!busy}>Cancelar</Button>
    </View> : <Button variant="ghost" icon="arrow-right-circle" onPress={() => { setTransferOpen(true); setError(''); setNotice(''); }} disabled={!!busy}>Transferir etiqueta para outra pessoa</Button>}
  </Sheet>;
}

const styles = StyleSheet.create({
  itemIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qrCard: { padding: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: 18, alignItems: 'center', gap: 10 },
  qrPaper: { backgroundColor: 'white', padding: 5 },
  qrTitle: { color: C.ink, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  localNote: { flexDirection: 'row', gap: 10, padding: 13, borderRadius: 12, backgroundColor: C.amberSoft, alignItems: 'flex-start' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  halfButton: { flex: 1, minWidth: 165, paddingHorizontal: 12 },
  nfcProgress: { padding: 15, backgroundColor: C.soft, borderRadius: 13, gap: 8 },
  privateNote: { padding: 15, borderRadius: 13, backgroundColor: C.raised, gap: 8 },
  transfer: { padding: 17, borderWidth: 1, borderColor: C.redLine, borderRadius: 15, gap: 14, backgroundColor: C.redSoft },
});
