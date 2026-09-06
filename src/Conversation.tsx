import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Text, View, ViewToken } from 'react-native';
import { api, Message, Report } from './api';
import { loadDraft, saveDraft } from './drafts';
import { useKeyboardFrame } from './keyboardFrame';
import { finderConversations, reportSummary } from './finder';
import { completeMutation, executeMutation, isDefiniteMutationRejection, loadPendingMutation, PendingMutation, prepareMutation } from './mutations';
import { Button, C, Field, Notice, s, Sheet } from './ui';

type Props = { id: string; token: string; finder?: boolean; ownerId?: string; onResolved?: () => void; onRead?: () => void; onSavedConversations?: () => void };
type CloseReason = 'mistake' | 'no_return' | 'unwanted';
const closeReasons: { value: CloseReason; label: string }[] = [{ value: 'mistake', label: 'Aviso por engano' }, { value: 'no_return', label: 'Não houve devolução' }, { value: 'unwanted', label: 'Contato indesejado' }];
function mergeMessages(previous: Message[], incoming: Message[]) { return [...new Map([...previous, ...incoming].map(message => [message.id, message])).values()].sort((a, b) => a.id - b.id); }
export default function Conversation({ id, token, finder = false, ownerId, onResolved, onRead, onSavedConversations }: Props) {
  const keyboard = useKeyboardFrame();
  const [report, setReport] = useState<Report>(); const [messages, setMessages] = useState<Message[]>([]); const [body, setBody] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState<PendingMutation<{ body: string }> | null>(null); const [action, setAction] = useState<'resolve' | 'close' | null>(null); const [newMessages, setNewMessages] = useState(false);
  const scroll = useRef<FlatList<Message>>(null); const generation = useRef(0); const identity = useRef(''); const draft = useRef(''); const draftRevision = useRef(0); const sending = useRef(false); const dataRevision = useRef(0);
  const contentHeight = useRef(0); const nearBottom = useRef(true); const followingTarget = useRef<number | null>(0); const latestId = useRef(0); const visibleIds = useRef<number[]>([]); const readSent = useRef(0); const readBusy = useRef(false); const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markVisibleRef = useRef<() => void>(() => {}); const actionRef = useRef(action); actionRef.current = action;
  const path = finder ? `/finder/reports/${id}` : `/reports/${id}`;
  const scope = finder ? `finder-message:${id}` : `owner-message:${ownerId || 'unbound'}:${id}`;
  identity.current = `${path}:${token}`;
  function isForeground() { return AppState.currentState !== 'background' && AppState.currentState !== 'inactive' && (Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState === 'visible'); }
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => { visibleIds.current = viewableItems.filter(item => item.isViewable).map(item => item.item.id); if (followingTarget.current !== null && visibleIds.current.includes(followingTarget.current)) { followingTarget.current = null; nearBottom.current = true; } markVisibleRef.current(); }).current;
  const viewability = useRef({ viewAreaCoveragePercentThreshold: 50, minimumViewTime: 350 }).current;
  markVisibleRef.current = () => {
    if (finder || actionRef.current || !isForeground() || readBusy.current) return;
    const lastMessageId = Math.max(0, ...visibleIds.current);
    if (lastMessageId <= readSent.current) return;
    if (readTimer.current) clearTimeout(readTimer.current);
    const current = generation.current; const route = identity.current;
    readTimer.current = setTimeout(async () => {
      if (current !== generation.current || route !== identity.current || actionRef.current || !isForeground()) return;
      const visibleId = Math.max(0, ...visibleIds.current);
      if (visibleId <= readSent.current || readBusy.current) return;
      readBusy.current = true;
      try {
        await api(`${path}/read`, token, { lastMessageId: visibleId });
        if (current === generation.current && route === identity.current) { readSent.current = Math.max(readSent.current, visibleId); onRead?.(); }
      } catch { /* A later visibility event or poll retries without marking unseen messages. */ }
      finally { if (current === generation.current && route === identity.current) readBusy.current = false; }
    }, 250);
  };
  useEffect(() => {
    const current = ++generation.current; const route = identity.current; let fetching = false;
    const live = () => current === generation.current && route === identity.current;
    setReport(undefined); setMessages([]); setBody(''); draft.current = ''; draftRevision.current = 0; setPending(null); setAction(null); setBusy(false); sending.current = false; setHydrated(false); setError('');
    nearBottom.current = true; followingTarget.current = 0; latestId.current = 0; visibleIds.current = []; readSent.current = 0; readBusy.current = false; setNewMessages(false);
    async function load() {
      if (fetching) return; fetching = true; const revision = dataRevision.current;
      try {
        const data = await api<{ report: Report; messages: Message[] }>(path, token);
        if (live() && revision === dataRevision.current) {
          setReport(data.report); setMessages(old => mergeMessages(old, data.messages));
          const last = data.messages.at(-1)?.id || 0;
          if (last > latestId.current) { if (nearBottom.current) followingTarget.current = last; else if (latestId.current) setNewMessages(true); }
          latestId.current = Math.max(latestId.current, last);
          if (finder) void finderConversations.remember(reportSummary(data.report)).catch(() => {});
          markVisibleRef.current();
        }
      } catch (issue) { if (live()) setError((issue as Error).message); }
      finally { fetching = false; }
    }
    void (async () => {
      try {
        const operation = await loadPendingMutation<{ body: string }>(scope); const saved = await loadDraft(scope);
        if (live()) { setPending(operation); const value = saved ?? operation?.payload.body ?? ''; setBody(value); draft.current = value; setHydrated(true); }
      } catch (issue) { if (live()) setError((issue as Error).message); }
    })();
    void load(); const timer = setInterval(load, 4000);
    const subscription = AppState.addEventListener('change', () => { if (isForeground()) { markVisibleRef.current(); void load(); } });
    const foreground = () => { if (isForeground()) { markVisibleRef.current(); void load(); } };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', foreground);
    return () => { generation.current++; clearInterval(timer); if (readTimer.current) clearTimeout(readTimer.current); subscription.remove(); if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', foreground); };
  }, [path, token, scope]);
  function editBody(value: string) {
    setBody(value); draft.current = value; draftRevision.current++; const current = generation.current;
    void saveDraft(scope, value).catch(issue => { if (current === generation.current) setError((issue as Error).message); });
  }
  async function send() {
    if (sending.current || !hydrated || (!draft.current.trim() && !pending)) return;
    if (!finder && !ownerId) { setError('Abra novamente esta conversa pela sua conta para enviar.'); return; }
    sending.current = true; setBusy(true); setError('');
    const current = generation.current; const route = identity.current; const revision = draftRevision.current; const submitted = draft.current;
    const live = () => current === generation.current && route === identity.current;
    let operation = pending;
    try {
      operation = await prepareMutation(scope, `${path}/messages`, { body: submitted.trim() });
      if (live()) setPending(operation);
      const result = await executeMutation<{ message: Message }>(operation, token);
      // If the screen left, keep the operation for an explicit replay on return.
      // Otherwise settle its draft before dropping the durable recovery proof.
      if (!live()) return;
      dataRevision.current++; if (nearBottom.current && result.message.id > latestId.current) followingTarget.current = result.message.id; setMessages(old => mergeMessages(old, [result.message])); latestId.current = Math.max(latestId.current, result.message.id);
      if (draftRevision.current === revision && draft.current.trim() === operation.payload.body) { setBody(''); draft.current = ''; await saveDraft(scope, ''); }
      await completeMutation(operation);
      if (live()) setPending(null);
    } catch (issue) {
      if (operation && isDefiniteMutationRejection(issue)) {
        try { await completeMutation(operation); if (live()) setPending(null); } catch { /* Retain the operation when local removal is unavailable. */ }
      }
      if (live()) setError((issue as Error).message);
    } finally { if (live()) { sending.current = false; setBusy(false); } }
  }
  async function finish(reason?: CloseReason) {
    if (sending.current) return; sending.current = true; setBusy(true); setError('');
    const current = generation.current; const route = identity.current; const live = () => current === generation.current && route === identity.current;
    try { const result = await api<{ report: Report }>(`${path}/${reason ? 'close' : 'resolve'}`, token, reason ? { reason } : {}); if (live()) { dataRevision.current++; setReport(result.report); setAction(null); onResolved?.(); } }
    catch (issue) { if (live()) setError((issue as Error).message); }
    finally { if (live()) { sending.current = false; setBusy(false); } }
  }
  function goToLatest() { nearBottom.current = true; followingTarget.current = latestId.current; setNewMessages(false); scroll.current?.scrollToOffset({ offset: contentHeight.current, animated: true }); }
  const closed = report && report.status !== 'open';
  const closedText = report?.closedReason === 'returned' || (report?.status === 'resolved' && !report?.closedReason) ? 'Devolução confirmada. Obrigado por fazer parte deste reencontro!' : `Conversa encerrada: ${closeReasons.find(reason => reason.value === report?.closedReason)?.label.toLowerCase() || 'aviso encerrado'}. Isso não registra uma devolução.`;
  return <View ref={keyboard.ref} onLayout={keyboard.onLayout} style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 850, alignSelf: 'center' }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} keyboardVerticalOffset={keyboard.offset} style={{ flex: 1, minHeight: 0, paddingHorizontal: 18, paddingBottom: 12, gap: 10 }}>
    <View style={{ gap: 4 }}><Text style={s.h3}>{report?.tagName || 'Conversa privada'}</Text>{!keyboard.visible && <Text style={s.small}>{finder ? 'Acesso salvo neste aparelho. Volte em Minhas conversas para ver respostas.' : `Com ${report?.finderName || 'quem encontrou'} · Contatos protegidos`}</Text>}</View>
    {!!error && <Notice error text={error} />}
    {!report && !error && <ActivityIndicator color={C.purple} />}
    <FlatList ref={scroll} data={messages} keyExtractor={message => String(message.id)} style={{ flex: 1, minHeight: keyboard.visible ? 0 : 80, backgroundColor: C.bg, borderRadius: 15 }} contentContainerStyle={{ padding: 12, gap: 14 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" accessibilityLabel="Histórico da conversa" testID="conversation-history" onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewability}
      onScroll={({ nativeEvent }) => { const { contentOffset, contentSize, layoutMeasurement } = nativeEvent; if (followingTarget.current === null) nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 70; if (nearBottom.current) setNewMessages(false); }} scrollEventThrottle={100}
      onLayout={() => { if (nearBottom.current || followingTarget.current !== null) { followingTarget.current = latestId.current; scroll.current?.scrollToOffset({ offset: contentHeight.current, animated: false }); } }} onScrollBeginDrag={() => { followingTarget.current = null; }} onContentSizeChange={(_width, height) => { contentHeight.current = height; if (followingTarget.current !== null || nearBottom.current) scroll.current?.scrollToOffset({ offset: height, animated: false }); }}
      renderItem={({ item: message }) => { const own = message.role === (finder ? 'finder' : 'owner'); return <View style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 4 }}><View style={{ backgroundColor: own ? C.purple : C.raised, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 16 }}><Text style={{ color: own ? C.onAccent : C.ink, fontSize: 14, lineHeight: 21 }}>{message.body}</Text></View><Text style={[s.small, { fontSize: 10, alignSelf: own ? 'flex-end' : 'flex-start' }]}>{own ? 'Você' : message.role === 'owner' ? 'Dono' : report?.finderName || 'Quem encontrou'} · {new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text></View>; }} />
    {newMessages && <Button variant="secondary" icon="arrow-down" onPress={goToLatest}>Novas mensagens</Button>}
    {closed ? <Notice text={closedText} /> : report ? <View style={{ gap: 8 }}>
      {pending && !busy && !keyboard.visible && <Text style={s.small}>Um envio aguarda confirmação. Recupere o resultado; seu novo rascunho continua aqui.</Text>}
      <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-end' }}><View style={{ flex: 1 }}><Field label="Mensagem" value={body} onChangeText={editBody} editable={hydrated} placeholder="Combine a entrega em um lugar público…" multiline maxLength={2000} style={{ minHeight: 62, maxHeight: 106 }} /></View><Button onPress={() => void send()} icon="send" busy={busy} disabled={!hydrated || (!body.trim() && !pending)} label={pending && !busy ? 'Recuperar envio' : 'Enviar'}>{pending && !busy ? 'Recuperar' : 'Enviar'}</Button></View>
      {!finder && !keyboard.visible && <View style={[s.row, { flexWrap: 'wrap' }]}><Button variant="ghost" onPress={() => setAction('resolve')} icon="check-circle">Confirmar devolução</Button><Button variant="ghost" onPress={() => setAction('close')}>Encerrar aviso</Button></View>}
    </View> : null}
    {finder && !keyboard.visible && onSavedConversations && <Button variant="ghost" onPress={onSavedConversations}>Minhas conversas</Button>}
    {action && <Sheet title={action === 'resolve' ? 'Confirmar devolução' : 'Encerrar aviso'} onClose={() => setAction(null)}>
      {action === 'resolve' ? <><Text style={s.body}>O objeto já está com você? A confirmação encerra todas as conversas abertas sobre este objeto e registra a devolução e mantém o QR ativo.</Text><Button onPress={() => void finish()} busy={busy} icon="check">Sim, recebi meu objeto</Button><Button variant="ghost" onPress={() => setAction(null)}>Ainda não</Button></> : <><Text style={s.body}>Encerra apenas este aviso, sem registrar devolução nem alterar o estado do objeto.</Text>{closeReasons.map(reason => <Button key={reason.value} variant="secondary" busy={busy} onPress={() => void finish(reason.value)}>{reason.label}</Button>)}</>}
    </Sheet>}
  </KeyboardAvoidingView></View>;
}
