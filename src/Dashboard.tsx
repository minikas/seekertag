import { KeyboardAwareScrollView, KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { api, ApiError, Report, Tag, User } from './api';
import { Button, C, categoryInfo, Field, formatDate, Icon, IconName, Notice, Pill, s } from './ui';
import TagForm from './TagForm';
import TagDetails from './TagDetails';
import Conversation from './Conversation';
import Account from './Account';
import Animated from 'react-native-reanimated';
import { useScrollHeader } from './useScrollHeader';

type Tab = 'items' | 'messages';
const tabs: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'items', label: 'Meus objetos', icon: 'home' },
  { key: 'messages', label: 'Conversas', icon: 'message-circle' },
];
const filters = [{ key: 'all', name: 'Todos' }, { key: 'active', name: 'Protegidos' }, { key: 'lost', name: 'Perdidos' }, { key: 'paused', name: 'Pausados' }];

export default function Dashboard({ token, user, onUserUpdated, onLogout, onScan, onHelp, onExpired }: { token: string; user: User; onUserUpdated: (user: User) => void; onLogout: () => Promise<void>; onScan: () => void; onHelp: () => void; onExpired: () => void }) {
  const [tags, setTags] = useState<Tag[]>([]); const [reports, setReports] = useState<Report[]>([]); const [tab, setTab] = useState<Tab>('items'); const [error, setError] = useState(''); const [refreshing, setRefreshing] = useState(false); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [form, setForm] = useState<Tag | 'new' | null>(null); const [selected, setSelected] = useState<Tag>(); const [chat, setChat] = useState<string>(); const [account, setAccount] = useState(false);
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  const header = useScrollHeader(headerHeight);
  const refresh = useCallback(async (silent = false) => { if (!silent) setRefreshing(true); try { const [items, inbox] = await Promise.all([api<{ tags: Tag[] }>('/tags', token), api<{ reports: Report[] }>('/reports', token)]); setTags(items.tags); setReports(inbox.reports); setError(''); } catch (e) { if (e instanceof ApiError && e.status === 401) onExpired(); else setError((e as Error).message); } finally { setRefreshing(false); } }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Do not refresh and rerender the covered dashboard while editing a form.
    if (form || selected || account) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(true); }, 6000);
    return () => clearInterval(timer);
  }, [refresh, form, selected, account]);
  const openReports = reports.filter(r => r.status === 'open');
  const filtered = tags.filter(t => (filter === 'all' || t.status === filter) && `${t.name} ${t.category}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const switchTab = (key: Tab) => { setTab(key); setChat(undefined); scroll.current?.scrollTo({ y: 0, animated: false }); header.reset(); };
  const saveTag = (tag: Tag) => { setTags(prev => prev.some(t => t.id === tag.id) ? prev.map(t => t.id === tag.id ? tag : t) : [tag, ...prev]); setSelected(tag); };

  const stats = [
    { label: 'Protegidos', value: tags.filter(t => t.status === 'active').length, icon: 'shield' as IconName, color: C.green },
    { label: 'Perdidos', value: tags.filter(t => t.status === 'lost').length, icon: 'search' as IconName, color: C.amber },
    { label: 'Reencontros', value: tags.reduce((n, t) => n + t.recoveryCount, 0), icon: 'heart' as IconName, color: C.accent },
  ];

  return <View style={styles.page}>
    <Animated.View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)} animatedProps={header.accessibilityProps} style={[styles.topBar, header.style]}><Button variant="ghost" icon="user" label="Minha conta" onPress={() => setAccount(true)} style={{ backgroundColor: C.surface, borderRadius: 18 }} /><Text style={{ color: C.ink, fontSize: 20, fontWeight: '500' }}>SeekerTag</Text><Button variant="ghost" icon="maximize" onPress={onScan} label="Escanear etiqueta" /></Animated.View>
    <KeyboardAwareScrollView bottomOffset={24} ref={scroll} onScroll={header.onScroll} scrollEventThrottle={16} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} progressViewOffset={headerHeight} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight }]}>
      <View style={styles.content}>
      {!!error && <Notice error text={error} />}
      {tab === 'items' ? <>
        <View style={styles.intro}><Text accessibilityRole="header" style={s.h1}>Meus objetos</Text><Text style={s.body}>Tudo o que importa, por perto.</Text></View>
        <View style={styles.stats}>{stats.map(stat => <View key={stat.label} style={styles.stat}>
          <Icon name={stat.icon} size={22} color={stat.color} /><Text style={styles.statValue}>{stat.value}</Text><Text style={styles.statLabel}>{stat.label}</Text>
        </View>)}</View>
        <Button onPress={() => setForm('new')} icon="plus">Adicionar objeto</Button>
        {openReports.length > 0 && <Pressable accessibilityRole="button" onPress={() => switchTab('messages')} style={({ pressed }) => [styles.alert, pressed && styles.pressed]}>
          <View style={[s.circle, { backgroundColor: C.soft }]}><Icon name="message-circle" color={C.accent} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>Tem um reencontro a caminho</Text><Text style={s.small}>{openReports.length} conversa(s) em aberto</Text></View><Icon name="chevron-right" color={C.muted} />
        </Pressable>}
        {tags.length > 0 && <View style={{ gap: 18 }}>
          <Field hideLabel label="Buscar objetos" placeholder="Buscar por nome ou categoria" value={search} onChangeText={setSearch} returnKeyType="search" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {filters.map(f => <Pressable key={f.key} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }} onPress={() => setFilter(f.key)} style={({ pressed }) => [styles.filter, { backgroundColor: filter === f.key ? C.primary : C.secondary }, pressed && styles.pressed]}><Text style={{ color: filter === f.key ? C.onPrimary : C.ink, fontSize: 16, fontWeight: '500' }}>{f.name}</Text></Pressable>)}
          </ScrollView>
        </View>}
        {filtered.length > 0 ? <View>
          <View style={[s.between, { marginBottom: 10 }]}><Text style={s.h2}>Etiquetas</Text><Text style={s.small}>{filtered.length} {filtered.length === 1 ? 'objeto' : 'objetos'}</Text></View>
          {filtered.map(tag => { const cat = categoryInfo(tag.category); return <Pressable key={tag.id} accessibilityRole="button" accessibilityLabel={`Abrir ${tag.name}`} onPress={() => setSelected(tag)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
            <View style={[s.circle, { backgroundColor: cat.color }]}><Icon name={cat.icon} size={26} /></View>
            <View style={{ flex: 1, gap: 8 }}><Text numberOfLines={2} style={s.h3}>{tag.name}</Text><View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}><Text style={s.small}>{tag.category}</Text><Pill status={tag.status} /></View>{tag.openReportCount > 0 && <Text style={[s.small, { color: C.accent }]}>{tag.openReportCount} conversa(s) em aberto</Text>}</View>
            <Icon name="chevron-right" color={C.muted} size={22} />
          </Pressable>; })}
        </View> : <View style={s.empty}>
          <View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name={search ? 'search' : 'tag'} size={32} /></View>
          <Text style={[s.h2, styles.center]}>{tags.length ? 'Nenhum objeto por aqui' : 'Sua primeira etiqueta'}</Text>
          <Text style={[s.body, styles.center]}>{tags.length ? 'Tente outro nome ou filtro para encontrar seu objeto.' : 'Adicione um objeto e crie um QR para ajudar quem o encontrar a falar com você.'}</Text>
        </View>}
        <Pressable accessibilityRole="button" accessibilityLabel="Como funciona" onPress={onHelp} style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}>
          <View style={s.circle}><Icon name="help-circle" /></View><View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>Como funciona</Text><Text style={s.small}>Uma etiqueta. Um caminho de volta.</Text></View><Icon name="chevron-right" color={C.muted} />
        </Pressable>
      </> : <>
        <View style={styles.intro}><Text accessibilityRole="header" style={s.h1}>Conversas</Text><Text style={s.body}>O próximo reencontro começa aqui.</Text></View>
        {chat ? <View style={{ gap: 24 }}><Button variant="ghost" icon="arrow-left" onPress={() => setChat(undefined)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}>Todas as conversas</Button><Conversation key={chat} id={chat} token={token} onResolved={() => void refresh()} /></View> : reports.length > 0 ? <View>{reports.map(report => <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={`Conversa sobre ${report.tagName}`} onPress={() => setChat(report.id)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <View style={s.circle}><Icon name={report.status === 'resolved' ? 'check' : 'message-circle'} color={report.status === 'resolved' ? C.green : C.ink} /></View>
          <View style={{ flex: 1, gap: 6 }}><Text numberOfLines={2} style={s.h3}>{report.tagName}</Text><Text style={s.small}>{report.finderName} · {report.status === 'resolved' ? 'Devolvido' : 'Em conversa'}</Text><Text numberOfLines={1} style={s.body}>{report.lastMessage}</Text><Text style={s.small}>{formatDate(report.updatedAt)}</Text></View><Icon name="chevron-right" color={C.muted} size={22} />
        </Pressable>)}</View> : <View style={s.empty}><View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="message-circle" size={32} /></View><Text style={[s.h2, styles.center]}>Tudo tranquilo por aqui</Text><Text style={[s.body, styles.center]}>Quando alguém escanear sua etiqueta e enviar um aviso, a conversa aparece aqui.</Text></View>}
      </>}
      </View>
    </KeyboardAwareScrollView>
    <View style={styles.navigation}>{tabs.map(t => <Pressable key={t.key} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: tab === t.key }} onPress={() => switchTab(t.key)} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View style={styles.tabIcon}>
        {tab === t.key && <View pointerEvents="none" style={styles.tabSelection} />}
        <Icon name={t.icon} color={tab === t.key ? C.onPrimary : C.ink} size={28} />{t.key === 'messages' && openReports.length > 0 && <View style={styles.badge} />}
      </View>
    </Pressable>)}</View>
    {account && <Account token={token} user={user} onUserUpdated={onUserUpdated} onClose={() => setAccount(false)} onHelp={onHelp} onLogout={onLogout} />}
    {form && <TagForm token={token} tag={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={tag => { saveTag(tag); setForm(null); }} />}
    {selected && !form && <TagDetails tag={selected} token={token} user={user} onClose={() => setSelected(undefined)} onUpdated={saveTag} onEdit={tag => setForm(tag)} onTransferred={() => { setSelected(undefined); void refresh(); }} />}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' }, topBar: { position: 'absolute', top: 0, width: '100%', maxWidth: 720, alignSelf: 'center', zIndex: 2, backgroundColor: C.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  scrollContent: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, gap: 26 }, intro: { gap: 8 }, center: { textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 10 }, stat: { flex: 1, backgroundColor: C.surface, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 18, gap: 8 }, statValue: { color: C.ink, fontSize: 32, fontWeight: '600', lineHeight: 39 }, statLabel: { color: C.muted, fontSize: 13, lineHeight: 18 },
  filters: { gap: 8, paddingVertical: 2 }, filter: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 22, minHeight: 106, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 22, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, alert: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }, pressed: { opacity: 0.65 },
  navigation: { flexDirection: 'row', backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 12, paddingBottom: 8 }, tab: { flex: 1, alignItems: 'center', gap: 6, minHeight: 56 },
  tabIcon: { width: 72, height: 52, alignItems: 'center', justifyContent: 'center' },
  // Mount the rounded background with its final color so Android preserves its corners when switching tabs.
  tabSelection: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20, backgroundColor: C.primary },
  badge: { position: 'absolute', top: 8, right: 15, width: 8, height: 8, backgroundColor: C.accent, borderRadius: 4 },
});
