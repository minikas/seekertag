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
  created?: boolean;
};
type Action = 'status' | 'download' | 'share' | 'transfer' | 'nfc' | 'prepare' | null;

export default function TagDetails({ tag, token, onClose, onUpdated, onEdit, onTransferred, created = false }: Props) {
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [format, setFormat] = useState<'standard' | 'compact' | 'fold'>('standard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mounted = useRef(true);
  const currentIdentity = useRef(`${tag.id}:${token}`);
  const operation = useRef(0);
  const active = useRef<Action>(null);
  currentIdentity.current = `${tag.id}:${token}`;
  const info = categoryInfo(tag.category);
  const publicAddress = new URL(tag.publicUrl);
  const localOnly = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(publicAddress.hostname) || publicAddress.hostname.endsWith('.local');
  const permanentWarning = localOnly ? 'Este link depende desta rede e deste computador. Para uma etiqueta permanente, use um endereço HTTPS público e estável.' : publicAddress.protocol !== 'https:' ? 'Este link usa HTTP. Antes de imprimir uma etiqueta permanente, configure um endereço HTTPS estável.' : '';
  const formats = { standard: { label: 'Padrão', dimensions: '88,2 × 73 mm', count: 6 }, compact: { label: 'Compacta', dimensions: '50 × 40 mm', count: 15 }, fold: { label: 'Dobrável', dimensions: '90 × 100 mm aberta; 90 × 50 mm dobrada', count: 4 } };
  const selectedFormat = formats[format];

  useEffect(() => {
    mounted.current = true;
    active.current = null;
    setBusy(null); setError(''); setNotice(''); setTransferOpen(false); setOptionsOpen(false); setEmail(''); setPassword('');
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
      await downloadLabel({ url: `${API_URL}/tags/${tag.id}/label.pdf?format=${format}`, token, fileName: `SeekerTag-${tag.code}-${format}.pdf` });
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

  function prepare(prepared: boolean) {
    void run('prepare', async () => {
      const { tag: updated } = await api<{ tag: Tag }>(`/tags/${tag.id}`, token, { prepared }, 'PATCH');
      return () => { onUpdated(updated); setNotice(prepared ? 'Preparo confirmado por você.' : 'Confirmação de preparo removida. O QR continua disponível.'); };
    });
  }

  return <Sheet title={created ? 'Etiqueta criada' : tag.name} subtitle={created ? tag.name : tag.category} onClose={close}>
    <View style={s.between}><Pill status={tag.status} /><Text style={s.small}>{tag.preparedAt ? 'Preparo confirmado por você' : 'Prenda e teste a etiqueta'}</Text></View>
    <View style={styles.qrCard}><View style={styles.qrPaper}><QRCode value={tag.publicUrl} size={144} backgroundColor="white" color="#252925" ecl="M" quietZone={10} /></View><Text style={styles.qrTitle}>Encontrou? Escaneie para devolver.</Text></View>
    <Button variant="ghost" icon={formatsOpen ? 'chevron-up' : 'chevron-down'} expanded={formatsOpen} onPress={() => setFormatsOpen(!formatsOpen)}>{`Formato: ${selectedFormat.label}`}</Button>
    {formatsOpen && <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(Object.keys(formats) as Array<keyof typeof formats>).map(value => <Button key={value} variant={format === value ? 'primary' : 'secondary'} onPress={() => setFormat(value)}>{formats[value].label}</Button>)}</View>
      <View style={{ alignItems: 'center', gap: 8 }}><View style={{ width: format === 'compact' ? 130 : 180, height: format === 'fold' ? 150 : format === 'compact' ? 104 : 120, borderWidth: 1, borderColor: C.muted, borderRadius: 4, alignItems: 'center', justifyContent: 'center' }}><Icon name="maximize" color={C.purple} size={30} />{format === 'fold' && <View style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.muted }} />}</View><Text style={[s.small, { textAlign: 'center' }]}>{selectedFormat.count} etiquetas por folha A4 · {selectedFormat.dimensions}</Text><Text style={s.small}>Prévia ilustrativa. Imprima em tamanho real (100%).</Text></View>
    </View>}
    {!!permanentWarning && <View style={styles.localNote}><Icon name="info" size={17} color={C.amber} /><Text style={[s.small, { color: C.amber, flex: 1 }]}>{permanentWarning}</Text></View>}
    <View style={{ gap: 10 }}>
      <Button onPress={download} busy={busy === 'download'} disabled={!!busy} icon="download">Baixar etiquetas em PDF</Button>
      {notice ? <Notice text={notice} /> : null}
      {error && !transferOpen ? <Notice text={error} error /> : null}
      <Text style={s.small}>Imprima, prenda ao objeto e abra o QR em outro celular para testar. Seus contatos continuam privados.</Text>
      {tag.status === 'paused' ? <><Notice text="O QR está pausado. Reative para receber avisos e mensagens." /><Button onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="play-circle">Reativar etiqueta</Button></> : <Button variant="secondary" onPress={() => prepare(!tag.preparedAt)} busy={busy === 'prepare'} disabled={!!busy} icon={tag.preparedAt ? 'check-circle' : 'check'}>{tag.preparedAt ? 'Desfazer confirmação de preparo' : 'Já prendi e testei a etiqueta'}</Button>}
    </View>
    <Button variant="ghost" icon={optionsOpen ? 'chevron-up' : 'chevron-down'} expanded={optionsOpen} onPress={() => setOptionsOpen(!optionsOpen)}>{optionsOpen ? 'Menos opções' : 'Mais opções'}</Button>
    {optionsOpen && <>
      <View style={styles.buttonRow}><Button style={styles.halfButton} variant="secondary" onPress={writeNfc} disabled={!!busy} icon="wifi">Gravar NFC</Button><Button style={styles.halfButton} variant="secondary" onPress={openPublicPage} disabled={!!busy} icon="external-link">Ver página pública</Button></View>
      {busy === 'nfc' && <View style={styles.nfcProgress}><View style={[s.row, { alignItems: 'flex-start' }]}><ActivityIndicator color={C.purple} /><View style={{ flex: 1, gap: 4 }}><Text style={s.label}>Aproxime a etiqueta NFC</Text><Text style={s.small}>Use uma etiqueta NDEF regravável. O link existente será substituído.</Text></View></View><Button variant="ghost" onPress={() => void cancelNfc()}>Cancelar gravação</Button></View>}
      <Field label="Link da etiqueta" value={tag.publicUrl} editable={false} selectTextOnFocus autoCapitalize="none" style={{ fontSize: 12 }} />
      <Button variant="secondary" icon={Platform.OS === 'web' ? 'copy' : 'share-2'} onPress={shareLink} busy={busy === 'share'} disabled={!!busy}>{Platform.OS === 'web' ? 'Copiar link' : 'Compartilhar link'}</Button>
      <View style={s.divider} /><Text style={s.h3}>Gerenciar objeto</Text>
      {tag.status === 'lost' ? <Button variant="secondary" onPress={() => changeStatus('active')} busy={busy === 'status'} disabled={!!busy} icon="check-circle">Já está comigo</Button> : tag.status === 'active' ? <Button variant="secondary" onPress={() => changeStatus('lost')} busy={busy === 'status'} disabled={!!busy} icon="alert-circle">Marcar como perdido</Button> : null}
      <View style={styles.buttonRow}><Button style={styles.halfButton} variant="secondary" icon="edit-2" onPress={() => onEdit(tag)} disabled={!!busy}>Editar objeto</Button>{tag.status !== 'paused' && <Button style={styles.halfButton} variant="ghost" icon="pause-circle" onPress={() => changeStatus('paused')} disabled={!!busy}>Pausar etiqueta</Button>}</View>
      {tag.description ? <View style={styles.privateNote}><Text style={s.label}>Sua anotação particular</Text><Text style={s.body}>{tag.description}</Text></View> : null}
      {tag.rewardAmount > 0 ? <View style={styles.privateNote}><Text style={s.label}>{tag.rewardAmount.toLocaleString('pt-BR')} {tag.rewardCurrency} de recompensa oferecida</Text><Text style={s.small}>Promessa combinada na conversa. Nenhum valor foi depositado pelo app.</Text></View> : null}
      {tag.recoveryCount > 0 && <Text style={s.small}>{tag.recoveryCount} devolução(ões) confirmada(s)</Text>}
      <View style={s.divider} />
      {transferOpen ? <View style={styles.transfer}>
        <Text style={s.h3}>Transferir para outra pessoa</Text>
        <Text style={s.body}>A etiqueta sairá da sua conta e o mesmo QR passará para a pessoa abaixo. Ela precisa ter uma conta SeekerTag.</Text>
        <Text style={s.small}>Suas conversas antigas continuam privadas. Anotação, mensagem pública e recompensa serão apagadas. Só a nova pessoa pode transferir a etiqueta de volta.</Text>
        {tag.openReportCount > 0 && <Notice error text="Conclua as conversas abertas deste objeto antes de transferir a etiqueta." />}
        <Field label="E-mail de quem vai receber" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!busy} placeholder="pessoa@exemplo.com" />
        <Field label="Sua senha atual" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} editable={!busy} onSubmitEditing={transfer} />
        {error ? <Notice text={error} error /> : null}
        <Button variant="danger" icon="arrow-right" onPress={transfer} busy={busy === 'transfer'} disabled={!!busy || tag.openReportCount > 0}>Confirmar transferência</Button>
        <Button variant="ghost" onPress={() => { setTransferOpen(false); setPassword(''); setError(''); }} disabled={!!busy}>Cancelar</Button>
      </View> : <Button variant="ghost" icon="arrow-right-circle" onPress={() => { setTransferOpen(true); setError(''); setNotice(''); }} disabled={!!busy}>Transferir etiqueta para outra pessoa</Button>}
    </>}
  </Sheet>;
}

const styles = StyleSheet.create({
  itemIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qrCard: { padding: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: 18, alignItems: 'center', gap: 10 },
  qrPaper: { backgroundColor: 'white', padding: 5 },
  qrTitle: { color: C.ink, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  localNote: { flexDirection: 'row', gap: 10, padding: 13, borderRadius: 12, backgroundColor: C.amberSoft, alignItems: 'flex-start' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  halfButton: { flex: 1, minWidth: 165, paddingHorizontal: 12 },
  nfcProgress: { padding: 15, backgroundColor: C.soft, borderRadius: 13, gap: 8 },
  privateNote: { padding: 15, borderRadius: 13, backgroundColor: C.raised, gap: 8 },
  transfer: { padding: 17, borderWidth: 1, borderColor: C.redLine, borderRadius: 15, gap: 14, backgroundColor: C.redSoft },
});
