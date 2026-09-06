import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { api, ApiError, Report, Tag, User } from './api';
import { completeMutation, executeMutation, loadPendingMutation, PendingMutation, prepareMutation } from './mutations';
import { Brand, Button, C, categoryInfo, Field, formatDate, Icon, IconName, Notice, Pill, Sheet, s } from './ui';
import TagForm from './TagForm';
import TagDetails from './TagDetails';
import Conversation from './Conversation';
import { WalletPanel } from './platform/WalletPanel';

type Tab = 'items' | 'messages' | 'settings';
export type DashboardProps = {
  token: string; user: User; onLogout: () => Promise<void>; onScan: () => void; onHelp: () => void;
  onExpired: (sourceToken: string) => void; onRecoveryCode?: (code: string) => Promise<void> | void;
  accountExtras?: React.ReactNode; homeExtras?: React.ReactNode;
  initialChatId?: string; onInitialChatHandled?: () => void;
};
export default function Dashboard({ token, user, onLogout, onScan, onHelp, onExpired, onRecoveryCode, accountExtras, homeExtras, initialChatId, onInitialChatHandled }: DashboardProps) {
  const { width } = useWindowDimensions(); const wide = width >= 950; const compact = width < 650;
  const [tags, setTags] = useState<Tag[]>([]); const [reports, setReports] = useState<Report[]>([]);
  const [tab, setTab] = useState<Tab>('items'); const [error, setError] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all');
  const [form, setForm] = useState<Tag | 'new' | null>(null); const [selected, setSelected] = useState<Tag>(); const [created, setCreated] = useState(false);
  const [chat, setChat] = useState<string>(); const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false); const [password, setPassword] = useState(''); const [recoveryError, setRecoveryError] = useState('');
  const [recoveryPending, setRecoveryPending] = useState<PendingMutation<Record<string, never>> | null>(null);
  const mounted = useRef(true); const identity = useRef(token); const requestNumber = useRef(0); const expiry = useRef(onExpired); const recoveryActive = useRef(false); const handledChat = useRef<string | undefined>(undefined);
  identity.current = token; expiry.current = onExpired;
  const refresh = useCallback(async (silent = false) => {
    const request = ++requestNumber.current; const requestToken = token;
    const current = () => mounted.current && identity.current === requestToken && requestNumber.current === request;
    if (!silent && current()) setRefreshing(true);
    try {
      const [items, inbox] = await Promise.all([api<{ tags: Tag[] }>('/tags', requestToken), api<{ reports: Report[] }>('/reports', requestToken)]);
      if (!current()) return;
      setTags(items.tags); setReports(inbox.reports); setError('');
      setSelected(previous => previous ? items.tags.find(item => item.id === previous.id) : undefined);
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 401) expiry.current(requestToken); else setError((e as Error).message);
    } finally { if (current()) setRefreshing(false); }
  }, [token]);
  useEffect(() => { mounted.current = true; void refresh(); const timer = setInterval(() => void refresh(true), 6000); return () => { mounted.current = false; requestNumber.current++; clearInterval(timer); }; }, [refresh]);
  useEffect(() => { if (!initialChatId) { handledChat.current = undefined; return; } if (handledChat.current !== initialChatId) { handledChat.current = initialChatId; setTab('messages'); setChat(initialChatId); onInitialChatHandled?.(); } }, [initialChatId, onInitialChatHandled]);
  useEffect(() => { let live = true; void loadPendingMutation<Record<string, never>>(`recovery:${user.id}`).then(saved => { if (live) setRecoveryPending(saved); }).catch(() => {}); return () => { live = false; }; }, [user.id]);
  const unread = reports.reduce((n, report) => n + (report.unreadCount || 0), 0);
  const filtered = tags.filter(t => (filter === 'all' || t.status === filter) && `${t.name} ${t.category}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const tabs: { key: Tab; label: string; icon: IconName }[] = [{ key: 'items', label: 'Meus objetos', icon: 'grid' }, { key: 'messages', label: 'Conversas', icon: 'message-circle' }, { key: 'settings', label: 'Minha conta', icon: 'user' }];
  function switchTab(key: Tab) { setTab(key); setChat(undefined); }
  function saveTag(tag: Tag) { requestNumber.current++; setRefreshing(false); setTags(previous => previous.some(t => t.id === tag.id) ? previous.map(t => t.id === tag.id ? tag : t) : [tag, ...previous]); setSelected(tag); }
  async function logout() { if (busy) return; const origin = token; setBusy(true); try { await onLogout(); } catch(e) { if (mounted.current && identity.current === origin) setError((e as Error).message); } finally { if (mounted.current && identity.current === origin) setBusy(false); } }
  async function rotateRecovery() {
    if (recoveryActive.current) return;
    if (password.length < 10) { setRecoveryError('Confirme sua senha atual.'); return; }
    const origin = token; const current = () => mounted.current && identity.current === origin;
    recoveryActive.current = true; setBusy(true); setRecoveryError('');
    let operation = recoveryPending;
    try {
      operation = operation || await prepareMutation<Record<string, never>>(`recovery:${user.id}`, '/account/recovery-code', {}, { sensitiveKeys: ['password'] });
      if (current()) setRecoveryPending(operation);
      const result = await executeMutation<{ recoveryCode: string }>(operation, origin, { password });
      if (!current()) return;
      if (!onRecoveryCode) throw new Error('Não foi possível exibir o código. Recupere esta operação novamente.');
      await onRecoveryCode(result.recoveryCode);
      await completeMutation(operation);
      if (current()) { setRecoveryPending(null); setPassword(''); setRecoveryOpen(false); }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OPERATION_SUPERSEDED' && operation) {
        try {
          await completeMutation(operation);
          if (current()) { setRecoveryPending(null); setRecoveryError('Outro código de recuperação foi gerado para esta conta. Gere um novo código para continuar.'); }
        } catch (storageError) { if (current()) setRecoveryError((storageError as Error).message); }
      } else if (current()) setRecoveryError((e as Error).message);
    }
    finally { recoveryActive.current = false; if (current()) setBusy(false); }
  }
  const nav = (vertical: boolean) => tabs.map(t => <Pressable key={t.key} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: tab === t.key }} onPress={() => switchTab(t.key)} style={{ flex: vertical ? undefined : 1, minHeight: 52, padding: 10, flexDirection: vertical ? 'row' : 'column', alignItems: 'center', gap: vertical ? 10 : 5, backgroundColor: vertical && tab === t.key ? C.soft : 'transparent', borderRadius: 11 }}><View><Icon name={t.icon} color={tab === t.key ? C.purple : C.muted} size={20} />{t.key === 'messages' && unread > 0 && <View style={{ position: 'absolute', top: -3, right: -5, width: 7, height: 7, backgroundColor: C.purple, borderRadius: 5 }} />}</View><Text style={{ color: tab === t.key ? C.purple : C.muted, fontSize: vertical ? 13 : 11, fontWeight: '600' }}>{t.label}</Text></Pressable>);
  return <View style={{ flex: 1, flexDirection: 'row' }}>
    {wide && <View style={{ width: 220, padding: 24, paddingTop: 30, borderRightWidth: 1, borderColor: C.line, backgroundColor: C.surface }}><Brand /><View style={{ gap: 6, marginTop: 36 }}>{nav(true)}</View><View style={{ flex: 1 }} /><Button variant="ghost" onPress={onHelp} icon="help-circle">Como funciona</Button><Text numberOfLines={1} style={[s.small, { marginTop: 20 }]}>{user.name}</Text></View>}
    <View style={{ flex: 1 }}>
      <View style={[s.between, { paddingHorizontal: compact ? 20 : 32, paddingVertical: 14, borderBottomWidth: 1, borderColor: C.line }]}>{wide ? <Text style={s.h3}>{tabs.find(t => t.key === tab)?.label}</Text> : <Brand />}<Button variant="ghost" icon="maximize" onPress={onScan} label="Escanear etiqueta">{compact ? '' : 'Escanear etiqueta'}</Button></View>
      {tab === 'messages' && chat ? <View style={{ flex: 1, padding: compact ? 12 : 24, gap: 10 }}><Button variant="ghost" onPress={() => setChat(undefined)} icon="arrow-left" style={{ alignSelf: 'flex-start' }}>Todas as conversas</Button><Conversation key={chat} id={chat} token={token} ownerId={user.id} onResolved={() => void refresh()} onRead={() => void refresh(true)} /></View> : <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={C.purple} />} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: compact ? 20 : 32, gap: 20, maxWidth: 1100, width: '100%', alignSelf: 'center', paddingBottom: 36 }}>
        {!!error && <Notice error text={error} />}
        {tab === 'items' ? <>
          <View style={s.between}><Text accessibilityRole="header" style={s.h2}>Meus objetos</Text>{tags.length > 0 && <Button onPress={() => setForm('new')} icon="plus">Criar etiqueta</Button>}</View>
          {unread > 0 && <Button variant="secondary" icon="message-circle" onPress={() => switchTab('messages')}>{`${unread} ${unread === 1 ? 'mensagem nova' : 'mensagens novas'}`}</Button>}
          {tags.length === 0 ? <View style={[s.card, { gap: 18, alignItems: 'center', paddingVertical: 30 }]}><View style={s.circle}><Icon name="tag" color={C.purple} size={26} /></View><Text style={s.h3}>Crie sua primeira etiqueta</Text><Text style={[s.body, { textAlign: 'center' }]}>Dê um nome ao objeto e gere o QR para imprimir.</Text><Button icon="plus" onPress={() => setForm('new')}>Criar etiqueta</Button></View> : <>
            <Field label="Buscar objetos" placeholder="Nome ou categoria" value={search} onChangeText={setSearch} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{[{ key: 'all', name: 'Todos' }, { key: 'active', name: 'QR ativos' }, { key: 'lost', name: 'Perdidos' }, { key: 'paused', name: 'Pausados' }].map(f => <Pressable key={f.key} accessibilityRole="button" accessibilityLabel={f.name} accessibilityState={{ selected: filter === f.key }} onPress={() => setFilter(f.key)} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: filter === f.key ? C.purple : C.surface }}><Text style={{ color: filter === f.key ? C.onAccent : C.muted, fontSize: 12 }}>{f.name}</Text></Pressable>)}</ScrollView>
            {filtered.length ? <View style={{ gap: 10 }}>{filtered.map(tag => { const cat = categoryInfo(tag.category); const itemUnread = reports.filter(r => r.tagId === tag.id).reduce((n, r) => n + (r.unreadCount || 0), 0); return <Pressable key={tag.id} accessibilityRole="button" accessibilityLabel={`Abrir ${tag.name}`} onPress={() => { setCreated(false); setSelected(tag); }} style={({ pressed }) => [{ padding: 16, borderRadius: 15, borderWidth: 1, borderColor: pressed ? C.purple : C.line, backgroundColor: C.surface, gap: 12 }]}><View style={s.row}><View style={{ width: 45, height: 45, borderRadius: 12, backgroundColor: cat.color, alignItems: 'center', justifyContent: 'center' }}><Icon name={cat.icon} color={C.purple} /></View><View style={{ flex: 1, gap: 5 }}><Text numberOfLines={1} style={s.h3}>{tag.name}</Text><Text style={s.small}>{tag.category} · {tag.preparedAt ? 'Preparo confirmado por você' : 'Prenda e teste a etiqueta'}</Text></View><Icon name="chevron-right" size={18} color={C.muted} /></View><View style={s.between}><Pill status={tag.status} />{itemUnread > 0 && <Text style={{ color: C.purple, fontSize: 12, fontWeight: '600' }}>{itemUnread} novas mensagens</Text>}</View></Pressable>; })}</View> : <View style={[s.card, { gap: 12 }]}><Text style={s.h3}>Nenhum objeto encontrado</Text><Text style={s.body}>Tente outro nome ou limpe os filtros.</Text><Button variant="secondary" onPress={() => { setSearch(''); setFilter('all'); }}>Limpar busca e filtros</Button></View>}
          </>}
          {homeExtras}
        </> : tab === 'messages' ? <>
          <Text accessibilityRole="header" style={s.h2}>Conversas</Text>
          {reports.length ? reports.map(report => <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={`Conversa sobre ${report.tagName}`} onPress={() => setChat(report.id)} style={[s.card, { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }]}><Icon name={report.status === 'resolved' ? 'check-circle' : 'message-circle'} color={C.purple} /><View style={{ flex: 1, gap: 6 }}><View style={[s.between, { flexWrap: 'wrap' }]}><Text style={s.h3}>{report.tagName}</Text><Text style={s.small}>{formatDate(report.updatedAt)}</Text></View><Text style={s.small}>{report.finderName} · {report.status !== 'open' ? report.closedReason === 'returned' ? 'Devolvido' : 'Encerrada' : 'Em conversa'}</Text><Text numberOfLines={1} style={s.body}>{report.lastMessageRole === 'owner' ? 'Você: ' : ''}{report.lastMessage}</Text>{(report.unreadCount || 0) > 0 && <Text style={{ color: C.purple, fontSize: 12, fontWeight: '600' }}>{report.unreadCount} novas mensagens</Text>}</View><Icon name="chevron-right" size={16} color={C.muted} /></Pressable>) : <View style={[s.card, { gap: 14 }]}><Text style={s.h3}>Nenhuma conversa ainda</Text><Text style={s.body}>Quando alguém abrir sua etiqueta e enviar uma mensagem, ela aparece aqui.</Text></View>}
        </> : <>
          <Text accessibilityRole="header" style={s.h2}>Minha conta</Text>
          <View style={[s.card, { gap: 12 }]}><Text style={s.h3}>{user.name}</Text><Text selectable style={s.body}>{user.email}</Text><Text style={s.small}>Seus dados de conta não aparecem nas etiquetas ou conversas.</Text></View>
          {accountExtras}
          <View style={[s.card, { gap: 14 }]}><Text style={s.h3}>Código de recuperação</Text><Text style={s.body}>Gere outro código se você perdeu o anterior. O código antigo deixará de funcionar.</Text><Button variant="secondary" onPress={() => { setPassword(''); setRecoveryError(''); setRecoveryOpen(true); }} icon="key">{recoveryPending ? 'Recuperar geração de código' : 'Gerar novo código'}</Button></View>
          <WalletPanel />
          <Button variant="ghost" onPress={onHelp} icon="help-circle">Como funciona</Button>
          <Button variant="secondary" onPress={logout} busy={busy} icon="log-out">Sair da conta</Button>
        </>}
      </ScrollView>}
      {!wide && <View style={{ flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.line, paddingVertical: 6 }}>{nav(false)}</View>}
    </View>
    {form && <TagForm token={token} ownerId={user.id} tag={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={tag => { setCreated(form === 'new'); saveTag(tag); setForm(null); }} />}
    {selected && !form && <TagDetails tag={selected} token={token} created={created} onClose={() => setSelected(undefined)} onUpdated={saveTag} onEdit={tag => setForm(tag)} onTransferred={() => { setSelected(undefined); void refresh(); }} />}
    {recoveryOpen && <Sheet title="Gerar novo código" onClose={() => { if (!busy) { setRecoveryOpen(false); setPassword(''); } }} footer={<Button onPress={rotateRecovery} busy={busy}>{recoveryPending ? 'Recuperar código gerado' : 'Gerar novo código'}</Button>}><Text style={s.body}>Confirme sua senha. O código atual será substituído e o novo aparecerá uma vez.</Text>{!!recoveryPending && <Notice text="Há uma geração sem confirmação. Vamos recuperar a mesma operação." />}<Field label="Sua senha atual" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" autoCapitalize="none" maxLength={128} editable={!busy} onSubmitEditing={rotateRecovery} />{!!recoveryError && <Notice error text={recoveryError} />}</Sheet>}
  </View>;
}
