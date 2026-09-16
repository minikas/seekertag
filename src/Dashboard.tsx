import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import { KeyboardAwareScrollView, KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import TagRow from './TagRow';
import ObjectsScreen from './ObjectsScreen';
import { TagFilter } from './tag-search.model';
import { conversationCount } from './i18n';
import { AppState, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { api, ApiError, Report, Tag, User } from './api';
import { Button, formatDate, Icon, IconName, Notice, useUI } from './ui';
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

export default function Dashboard({ token, user, onUserUpdated, onLogout, onScan, onHelp, onExpired }: { token: string; user: User; onUserUpdated: (user: User) => void; onLogout: () => Promise<void>; onScan: () => void; onHelp: () => void; onExpired: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [tags, setTags] = useState<Tag[]>([]); const [reports, setReports] = useState<Report[]>([]); const [tab, setTab] = useState<Tab>('items'); const [error, setError] = useState(''); const [refreshing, setRefreshing] = useState(false); const [browsing, setBrowsing] = useState<TagFilter | null>(null); const [form, setForm] = useState<Tag | 'new' | null>(null); const [selected, setSelected] = useState<Tag>(); const [chat, setChat] = useState<string>(); const [account, setAccount] = useState(false);
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  const header = useScrollHeader(headerHeight);
  const refresh = useCallback(async (silent = false) => { if (!silent) setRefreshing(true); try { const [items, inbox] = await Promise.all([api<{ tags: Tag[] }>('/tags', token), api<{ reports: Report[] }>('/reports', token)]); setTags(items.tags); setSelected(current => current ? items.tags.find(tag => tag.id === current.id) : current); setReports(inbox.reports); setError(''); } catch (e) { if (e instanceof ApiError && e.status === 401) onExpired(); else setError((e as Error).message); } finally { setRefreshing(false); } }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Do not refresh and rerender the covered dashboard while editing a form.
    if (form || selected || account || browsing) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(true); }, 6000);
    return () => clearInterval(timer);
  }, [refresh, form, selected, account, browsing]);
  const homeTags = tags.slice(0, 3);
  const openReports = reports.filter(r => r.status === 'open');
  const switchTab = (key: Tab) => { setAccount(false); setTab(key); setChat(undefined); scroll.current?.scrollTo({ y: 0, animated: false }); header.reset(); };
  const saveTag = (tag: Tag) => { setTags(prev => prev.some(t => t.id === tag.id) ? prev.map(t => t.id === tag.id ? tag : t) : [tag, ...prev]); setSelected(tag); };

  const stats: { label: string; value: number; filter: TagFilter }[] = [
    { label: t("Protegidos"), value: tags.filter(t => t.status === 'active').length, filter: 'active' },
    { label: t("Perdidos"), value: tags.filter(t => t.status === 'lost').length, filter: 'lost' },
    { label: t("Reencontrados"), value: tags.filter(t => t.recoveryCount > 0).length, filter: 'recovered' },
  ];

  return <View style={styles.page}>
    <View style={{ flex: 1, display: account ? 'none' : 'flex' }} accessibilityElementsHidden={account} importantForAccessibility={account ? 'no-hide-descendants' : 'auto'}>
    <Animated.View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)} animatedProps={header.accessibilityProps} style={[styles.topBar, header.style]}><Button variant="ghost" icon="user" label={t("Minha conta")} onPress={() => setAccount(true)} style={{ backgroundColor: C.surface, borderRadius: 18 }} /><Text style={{ color: C.ink, fontSize: 20, fontWeight: '500' }}>SeekerTag</Text><Button variant="ghost" icon="maximize" onPress={onScan} label={t("Escanear etiqueta")} /></Animated.View>
    <KeyboardAwareScrollView bottomOffset={24} ref={scroll} onScroll={header.onScroll} scrollEventThrottle={16} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} progressViewOffset={headerHeight} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight }]}>
      <View style={styles.content}>
      {!!error && <Notice error text={error} />}
      {tab === 'items' ? <>
        <Text accessibilityRole="header" style={s.h1}>{t("Meus objetos")}</Text>
        <View style={styles.stats}>{stats.map(stat => <Pressable key={stat.filter} accessibilityRole="button" accessibilityLabel={stat.label} onPress={() => setBrowsing(stat.filter)} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
          <Text style={styles.statValue}>{stat.value.toLocaleString(locale)}</Text><Text style={styles.statLabel}>{stat.label}</Text>
        </Pressable>)}</View>
        <Button onPress={() => setForm('new')} icon="plus">{t("Adicionar objeto")}</Button>
        {openReports.length > 0 && <Pressable accessibilityRole="button" onPress={() => switchTab('messages')} style={({ pressed }) => [styles.alert, pressed && styles.pressed]}>
          <View style={[s.circle, { backgroundColor: C.soft }]}><Icon name="message-circle" color={C.accent} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{t("Tem um reencontro a caminho")}</Text><Text style={s.small}>{conversationCount(t, openReports.length, locale)}</Text></View><Icon name="chevron-right" color={C.muted} />
        </Pressable>}
        {tags.length > 0 ? <View>
          <View style={[s.between, { marginBottom: 10 }]}><Text style={s.h2}>{t("Objetos")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Ver todos")} onPress={() => setBrowsing('all')} style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}><Text style={s.body}>{t("Ver todos")}</Text><Icon name="chevron-right" size={20} color={C.muted} /></Pressable></View>
          {homeTags.map((tag, index) => <TagRow key={tag.id} tag={tag} last={index === homeTags.length - 1} onPress={() => setSelected(tag)} />)}
        </View> : <View style={s.empty}>
          <View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="tag" size={32} /></View>
          <Text style={[s.h2, styles.center]}>{t("Sua primeira etiqueta")}</Text>
          <Text style={[s.body, styles.center]}>{t("Adicione um objeto e crie um QR para ajudar quem o encontrar a falar com você.")}</Text>
        </View>}
        <Pressable accessibilityRole="button" accessibilityLabel={t("Como funciona")} onPress={onHelp} style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}><View style={s.settingsIcon}><Icon name="help-circle" size={20} /></View><Text style={[s.body, { flex: 1, color: C.ink }]}>{t("Como funciona")}</Text><Icon name="chevron-right" color={C.muted} size={20} /></Pressable>
      </> : <>
        {reports.length > 0 && <Text accessibilityRole="header" style={s.h1}>{t("Conversas")}</Text>}
        {chat ? <View style={{ gap: 24 }}><Button variant="ghost" icon="arrow-left" onPress={() => setChat(undefined)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}>{t("Todas as conversas")}</Button><Conversation key={chat} id={chat} token={token} onResolved={() => void refresh()} /></View> : reports.length > 0 ? <View>{reports.map(report => <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={t("Conversa sobre {name}", { name: report.tagName })} onPress={() => setChat(report.id)} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <View style={s.circle}><Icon name={report.status === 'resolved' ? 'check' : 'message-circle'} color={report.status === 'resolved' ? C.green : C.ink} /></View>
          <View style={{ flex: 1, gap: 6 }}><Text numberOfLines={2} style={s.h3}>{report.tagName}</Text><Text style={s.small}>{report.finderName} · {report.status === 'resolved' ? t("Devolvido") : t("Em conversa")}</Text><Text numberOfLines={1} style={s.body}>{report.lastMessage}</Text><Text style={s.small}>{formatDate(report.updatedAt, locale)}</Text></View><Icon name="chevron-right" color={C.muted} size={22} />
        </Pressable>)}</View> : <View style={[s.empty, { flex: 1 }]}><View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="message-circle" size={32} /></View><Text style={[s.h2, styles.center]}>{t("Tudo tranquilo por aqui")}</Text><Text style={[s.body, styles.center]}>{t("Quando alguém escanear sua etiqueta e enviar um aviso, a conversa aparece aqui.")}</Text></View>}
      </>}
      </View>
    </KeyboardAwareScrollView>
    </View>
    {account && <Account token={token} user={user} onUserUpdated={onUserUpdated} onClose={() => setAccount(false)} onHelp={onHelp} onLogout={onLogout} onCategoriesChanged={() => void refresh(true)} />}
    {!account && <View style={styles.navigation}>{tabs.map(tabItem => <Pressable key={tabItem.key} accessibilityRole="tab" accessibilityLabel={t(tabItem.label)} accessibilityState={{ selected: tab === tabItem.key }} onPress={() => switchTab(tabItem.key)} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View style={styles.tabIcon}>
        {!account && tab === tabItem.key && <View pointerEvents="none" style={styles.tabSelection} />}
        <Icon name={tabItem.icon} color={!account && tab === tabItem.key ? C.onPrimary : C.ink} size={28} />{tabItem.key === 'messages' && openReports.length > 0 && <View style={styles.badge} />}
      </View>
    </Pressable>)}</View>}
    {browsing && <ObjectsScreen initialFilter={browsing} tags={tags} onSelect={setSelected} onClose={() => setBrowsing(null)} refreshing={refreshing} onRefresh={() => void refresh()} error={error} covered={!!selected || !!form} suspended={!!form} />}
    {form && <TagForm onCategoriesChanged={() => void refresh(true)} token={token} tag={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={tag => { saveTag(tag); setForm(null); }} />}
    {selected && !form && <TagDetails tag={selected} token={token} user={user} onClose={() => setSelected(undefined)} onUpdated={saveTag} onEdit={tag => setForm(tag)} onTransferred={() => { setSelected(undefined); void refresh(); }} />}
  </View>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' }, topBar: { position: 'absolute', top: 0, width: '100%', maxWidth: 720, alignSelf: 'center', zIndex: 2, backgroundColor: C.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  scrollContent: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 26 }, center: { textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 16 }, stat: { flex: 1, gap: 5 }, statValue: { color: C.ink, fontSize: 28, fontWeight: '500', lineHeight: 34 }, statLabel: { color: C.muted, fontSize: 14, lineHeight: 21 },
  viewAll: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 22, minHeight: 106, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 'auto', minHeight: 72, paddingTop: 20, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }, pressed: { opacity: 0.65 },
  navigation: { flexDirection: 'row', backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 12, paddingBottom: 8 }, tab: { flex: 1, alignItems: 'center', gap: 6, minHeight: 56 },
  tabIcon: { width: 72, height: 52, alignItems: 'center', justifyContent: 'center' },
  // Mount the rounded background with its final color so Android preserves its corners when switching tabs.
  tabSelection: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20, backgroundColor: C.primary },
  badge: { position: 'absolute', top: 8, right: 15, width: 8, height: 8, backgroundColor: C.accent, borderRadius: 4 },
});
