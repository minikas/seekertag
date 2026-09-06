import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api, Report, Tag } from './api';
import Conversation from './Conversation';
import { finderConversations, reportSummary } from './finder';
import { loadDraft, saveDraft } from './drafts';
import { useKeyboardFrame } from './keyboardFrame';
import { completeMutation, executeMutation, isDefiniteMutationRejection, loadPendingMutation, PendingMutation, prepareMutation } from './mutations';
import { secureStorage } from './platform/storage';
import { Brand, Button, categoryInfo, C, Field, Icon, Notice, s } from './ui';

type ReportPayload = { finderName: string; message: string };
type Props = { code?: string; chatId?: string; goHome: () => void; goChat: (id: string) => void; onSavedConversations?: () => void };
export default function Found({ code, chatId, goHome, goChat, onSavedConversations }: Props) {
  const keyboard = useKeyboardFrame();
  const [tag, setTag] = useState<Tag>(); const [finderName, setFinderName] = useState(''); const [message, setMessage] = useState(''); const [showName, setShowName] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [chatToken, setChatToken] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMutation<ReportPayload> | null>(null);
  const generation = useRef(0); const draftRevision = useRef(0); const messageRef = useRef(''); const sending = useRef(false); const identity = useRef('');
  identity.current = `${code || ''}:${chatId || ''}`;
  const scope = `finder-report:${code || ''}`;

  useEffect(() => {
    const current = ++generation.current; const route = identity.current;
    const live = () => generation.current === current && identity.current === route;
    setLoading(true); setError(''); setTag(undefined); setChatToken(null); setPending(null); setBusy(false); sending.current = false; setFinderName(''); setShowName(false); setMessage(''); messageRef.current = ''; draftRevision.current = 0;
    async function load() {
      try {
        if (chatId) {
          const token = await secureStorage.get(`finder-${chatId}`);
          if (!token) throw new Error('Este acesso não está salvo neste aparelho. Volte pelo navegador usado no aviso ou escaneie a etiqueta para iniciar outra conversa.');
          const { report } = await api<{ report: Report }>(`/finder/reports/${chatId}`, token);
          await finderConversations.remember(reportSummary(report)).catch(() => {});
          if (live()) setChatToken(token);
        } else if (code) {
          const operation = await loadPendingMutation<ReportPayload>(scope);
          const draft = await loadDraft(scope);
          if (live()) { setPending(operation); setMessage(draft ?? operation?.payload.message ?? ''); messageRef.current = draft ?? operation?.payload.message ?? ''; setFinderName(operation?.payload.finderName || ''); }
          const previous = await secureStorage.get(`tag-chat-${code}`);
          if (previous && !operation) {
            const token = await secureStorage.get(`finder-${previous}`);
            if (token) {
              const { report } = await api<{ report: Report }>(`/finder/reports/${previous}`, token);
              await finderConversations.remember(reportSummary(report)).catch(() => {});
              if (report.status === 'open') { if (live()) goChat(previous); return; }
              await secureStorage.remove(`tag-chat-${code}`);
            }
          }
          const result = await api<{ tag: Tag }>(`/public/tags/${encodeURIComponent(code)}`);
          if (live()) setTag(result.tag);
        }
      } catch (issue) { if (live()) setError((issue as Error).message); }
      finally { if (live()) setLoading(false); }
    }
    void load();
    return () => { generation.current++; };
  }, [code, chatId]);

  function editMessage(value: string) { setMessage(value); messageRef.current = value; draftRevision.current++; const current = generation.current; void saveDraft(scope, value).catch(issue => { if (current === generation.current) setError((issue as Error).message); }); }
  async function submit() {
    if (!code || sending.current || (!message.trim() && !pending)) { if (!message.trim()) setError('Escreva uma mensagem para avisar onde encontrou o objeto.'); return; }
    sending.current = true; setBusy(true); setError('');
    const current = generation.current; const route = identity.current; const submittedDraft = messageRef.current; const revision = draftRevision.current;
    const live = () => generation.current === current && identity.current === route;
    let operation: PendingMutation<ReportPayload> | null = pending;
    try {
      operation = await prepareMutation(scope, `/public/tags/${code}/reports`, { finderName: finderName.trim() || 'Uma pessoa que quer ajudar', message: submittedDraft.trim() });
      if (live()) setPending(operation);
      const result = await executeMutation<{ report: Report; token: string }>(operation);
      await finderConversations.save(reportSummary(result.report), result.token);
      if (live() && (draftRevision.current !== revision || messageRef.current.trim() !== operation.payload.message)) {
        let copiedRevision: number;
        do { copiedRevision = draftRevision.current; await saveDraft(`finder-message:${result.report.id}`, messageRef.current); } while (live() && copiedRevision !== draftRevision.current);
      }
      await completeMutation(operation);
      if (live()) {
        if (draftRevision.current === revision && messageRef.current.trim() === operation.payload.message) await saveDraft(scope, '');
        if (live()) { setPending(null); goChat(result.report.id); }
      }
    } catch (issue) {
      if (operation && isDefiniteMutationRejection(issue)) { try { await completeMutation(operation); if (live()) setPending(null); } catch { /* Preserve the operation if local removal fails. */ } }
      if (live()) setError((issue as Error).message);
    } finally { if (live()) { sending.current = false; setBusy(false); } }
  }
  const cat = categoryInfo(tag?.category || 'Outro');
  const navigation = <View style={[s.between, { paddingHorizontal: 22, paddingVertical: 16, gap: 10 }]}><Brand /><View style={s.row}>{onSavedConversations && <Button label="Minhas conversas" variant="ghost" icon="message-circle" onPress={onSavedConversations} />}<Button variant="ghost" icon="home" onPress={goHome} label="Página inicial" /></View></View>;
  if (chatId && chatToken) return <View style={{ flex: 1, backgroundColor: C.bg }}>{navigation}{!keyboard.visible && <View style={{ paddingHorizontal: 22, paddingBottom: 10 }}><Text accessibilityRole="header" style={s.h2}>Obrigado por ajudar.</Text></View>}<Conversation id={chatId} token={chatToken} finder onSavedConversations={onSavedConversations} /></View>;
  return <View ref={keyboard.ref} onLayout={keyboard.onLayout} style={{ flex: 1, backgroundColor: C.bg }}><KeyboardAvoidingView style={{ flex: 1 }} keyboardVerticalOffset={keyboard.offset} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>{navigation}<ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingTop: 8, gap: 18 }}>
    {loading && <ActivityIndicator color={C.purple} />}
    {!!error && <Notice error text={error} />}
    {tag && <View style={[s.card, { padding: 22, gap: 18 }]}>
      <View style={[s.row, { alignItems: 'flex-start' }]}><View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: cat.color }}><Icon name={cat.icon} color={C.purple} size={23} /></View><View style={{ flex: 1, gap: 6 }}><Text accessibilityRole="header" style={s.h2}>{tag.name}</Text><Text style={s.small}>{tag.status === 'lost' ? 'O dono marcou este objeto como perdido.' : 'Encontrou este objeto? Avise o dono por aqui.'}</Text></View></View>
      <Field label="Mensagem para o dono" value={message} onChangeText={editMessage} placeholder="Oi! Encontrei seu objeto. Podemos combinar a devolução por aqui." multiline maxLength={2000} style={{ minHeight: 105, maxHeight: 180 }} />
      {pending && <Notice text="Um envio anterior aguarda confirmação. Vamos recuperar o resultado antes de enviar outra mensagem. Seu novo rascunho fica preservado." />}
      <Button onPress={() => void submit()} busy={busy} icon="send">{pending && !busy ? 'Recuperar aviso anterior' : 'Avisar o dono'}</Button>
      {showName ? <Field label="Como podemos te chamar? (opcional)" value={finderName} onChangeText={setFinderName} placeholder="Seu primeiro nome ou apelido" maxLength={60} /> : <Button variant="ghost" onPress={() => setShowName(true)}>Adicionar meu nome (opcional)</Button>}
      <Text style={s.small}>Sem cadastro. Seu telefone e e-mail não são compartilhados. Volte em Minhas conversas para ver a resposta.</Text>
      {!!tag.publicMessage && <View style={{ backgroundColor: C.bg, padding: 14, borderRadius: 12, gap: 6 }}><Text style={s.label}>Mensagem do dono</Text><Text style={s.body}>{tag.publicMessage}</Text></View>}
      {tag.rewardAmount > 0 && <Notice text={`${tag.rewardCurrency === 'BRL' ? 'R$' : tag.rewardCurrency} ${tag.rewardAmount} de agradecimento oferecido. É uma promessa do dono; nenhum valor foi depositado pelo app.`} />}
    </View>}
    {!tag && !loading && pending && <Button onPress={() => void submit()} busy={busy}>Recuperar aviso anterior</Button>}
  </ScrollView></KeyboardAvoidingView></View>;
}
