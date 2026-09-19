import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import React, { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiQueryKey, apiQueryOptions, invalidateApiResources, queryClient } from './query';
import TagRow from './TagRow';
import ObjectsScreen from './ObjectsScreen';
import NotificationsScreen from './NotificationsScreen';
import { useNotifications } from './NotificationsProvider';
import type { NotificationTarget } from './notifications.model';
import { homePreviewTags, matchesTagFilter, TagFilter } from './tag-search.model';
import { conversationCount } from './i18n';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { ApiError, Report, Tag, User } from './api';
import { Button, formatDate, Icon, IconName, Notice, useUI } from './ui';
import TagForm from './TagForm';
import TagDetails from './TagDetails';
import Conversation from './Conversation';
import Account from './Account';
import { Sheet } from './ui';
import { PageLayer, useNavigationState } from './Navigation';
import Animated from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useScrollHeader } from './useScrollHeader';

type Tab = 'items' | 'messages' | 'tags';
const tabs: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'items', label: 'Página inicial', icon: 'home' },
  { key: 'messages', label: 'Conversas', icon: 'message-circle' },
  { key: 'tags', label: 'Objetos', icon: 'box' },
];

export default function Dashboard({ token, user, onUserUpdated, onLogout, onScan, onHelp, helpDismissed = false, onExpired, notification, onNotificationOpened }: { notification?: NotificationTarget; onNotificationOpened: () => void; token: string; user: User; onUserUpdated: (user: User) => void; onLogout: () => Promise<void>; onScan: () => void; onHelp: () => void; helpDismissed?: boolean; onExpired: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const inbox = useNotifications();
  const navigation = useNavigationState();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [finderChat, setFinderChat] = useState(false);
  const [browseRevision, setBrowseRevision] = useState(0);
  const [tab, setTab] = useState<Tab>('items');
  const [refreshing, setRefreshing] = useState(false);
  const [browsing, setBrowsing] = useState<TagFilter>('all');
  const [form, setForm] = useState<string | 'new' | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [conversationTagId, setConversationTagId] = useState<string>();
  const [chat, setChat] = useState<string>();
  const [account, setAccount] = useState(false);
  const [rewardOnly, setRewardOnly] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(72);
  const itemHeader = useScrollHeader(headerHeight);
  const messageHeader = useScrollHeader(headerHeight);
  const covered = !!(form || selectedId || account || chat || notificationsOpen);
  // Covered screens remain subscribed to invalidations; only polling pauses.
  const tagsQuery = useQuery({ ...apiQueryOptions<{ tags: Tag[] }>('/tags', token), refetchInterval: covered ? false : 6000 });
  const reportsQuery = useQuery({ ...apiQueryOptions<{ reports: Report[] }>('/reports', token), refetchInterval: covered ? false : 6000 });
  const tags = tagsQuery.data?.tags ?? [];
  const reports = reportsQuery.data?.reports ?? [];
  const selected = tags.find(tag => tag.id === selectedId);
  const formTag = form && form !== 'new' ? tags.find(tag => tag.id === form) : undefined;
  const conversationTag = reports.find(report => report.id === conversationTagId);
  const queryError = tagsQuery.error || reportsQuery.error;
  const error = queryError?.message || '';
  const initialLoading = tagsQuery.isPending;
  const setSelected = (tag?: Tag) => setSelectedId(tag?.id);
  useEffect(() => { if (queryError instanceof ApiError && queryError.status === 401) onExpired(); }, [queryError, onExpired]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([tagsQuery.refetch({ cancelRefetch: false }), reportsQuery.refetch({ cancelRefetch: false })]); }
    finally { setRefreshing(false); }
  }, [tagsQuery.refetch, reportsQuery.refetch]);
  const homeTags = homePreviewTags(tags);
  const openReports = reports.filter(r => r.status === 'open');
  const switchTab = (key: Tab) => { setAccount(false); setNotificationsOpen(false); setTab(key); setChat(undefined); setFinderChat(false); };
  const browseTags = (filter: TagFilter) => { setBrowsing(filter); setBrowseRevision(value => value + 1); switchTab('tags'); };
  useEffect(() => {
    // A deliberate notification tap replaces pages, including another chat.
    // Forms and modal tasks keep the target queued until their own guard permits exit.
    if (!notification || form || navigation.tasks > 0) return;
    setSelectedId(undefined); setConversationTagId(undefined); setAccount(false); setNotificationsOpen(false);
    setFinderChat(notification.finder); setChat(notification.reportId); onNotificationOpened();
  }, [notification, form, navigation.tasks, onNotificationOpened]);
  const saveTag = (tag: Tag) => {
    queryClient.setQueryData<{ tags: Tag[] }>(apiQueryKey(token, '/tags'), previous => ({
      tags: previous?.tags.some(item => item.id === tag.id) ? previous.tags.map(item => item.id === tag.id ? tag : item) : [tag, ...(previous?.tags ?? [])],
    }));
    queryClient.setQueryData(apiQueryKey(token, `/tags/${tag.id}`), { tag });
    setSelectedId(tag.id);
  };
  const finishReturn = (tagId: string) => {
    queryClient.setQueryData<{ reports: Report[] }>(apiQueryKey(token, '/reports'), previous => previous && ({
      reports: previous.reports.map(report => report.tagId === tagId ? { ...report, status: 'resolved' } : report),
    }));
    void invalidateApiResources(token, ['/tags', '/reports']);
  };

  const stats: { label: string; value: number; filter: TagFilter }[] = [
    { label: t("Protegidos"), value: tags.filter(tag => matchesTagFilter(tag, 'active')).length, filter: 'active' },
    { label: t("Perdidos"), value: tags.filter(tag => matchesTagFilter(tag, 'lost')).length, filter: 'lost' },
    { label: t("Reencontrados"), value: tags.filter(tag => matchesTagFilter(tag, 'recovered')).length, filter: 'recovered' },
  ];

  return <View style={styles.page}>
    <View style={{ flex: 1 }}>
    {(['items', 'messages'] as const).map(pane => { const header = pane === 'items' ? itemHeader : messageHeader; return (
    <View key={pane} style={[StyleSheet.absoluteFill, { opacity: pane === tab ? 1 : 0 }]} pointerEvents={pane === tab ? 'auto' : 'none'} accessibilityElementsHidden={pane !== tab || navigation.top !== 0} importantForAccessibility={pane !== tab || navigation.top !== 0 ? 'no-hide-descendants' : 'auto'}>
    <Animated.View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)} animatedProps={header.accessibilityProps} style={[styles.topBar, header.style]}><Button variant="ghost" icon="user" label={t("Minha conta")} onPress={() => setAccount(true)} style={{ backgroundColor: C.surface, borderRadius: 18 }} /><Text style={{ color: C.ink, fontSize: 20, fontWeight: '500' }}>SeekerTag</Text><View style={{ flexDirection: 'row', alignItems: 'center' }}><View><Button variant="ghost" icon="bell" onPress={() => setNotificationsOpen(true)} label={inbox.unreadCount ? t("Notificações, {count} não lidas", { count: inbox.unreadCount }) : t("Notificações")} />{inbox.unreadCount > 0 && <View pointerEvents="none" style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{inbox.unreadCount > 99 ? '99+' : inbox.unreadCount}</Text></View>}</View><Button variant="ghost" icon="maximize" onPress={onScan} label={t("Escanear etiqueta")} /></View></Animated.View>
    <KeyboardAwareScrollView bottomOffset={24} onScroll={header.onScroll} scrollEventThrottle={16} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} progressViewOffset={headerHeight} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight }]}>
      <View style={styles.content}>
      {!!error && <Notice error text={error} />}
      {pane === 'items' ? initialLoading ? <DashboardSkeleton /> : <>
        <Text accessibilityRole="header" style={s.h1}>{t("Meus objetos")}</Text>
        <View style={styles.stats}>{stats.map(stat => <Pressable key={stat.filter} accessibilityRole="button" accessibilityLabel={stat.label} onPress={() => browseTags(stat.filter)} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
          <Text style={styles.statValue}>{stat.value.toLocaleString(locale)}</Text><Text style={styles.statLabel}>{stat.label}</Text>
        </Pressable>)}</View>
        <Button onPress={() => setForm('new')} icon="plus">{t("Adicionar objeto")}</Button>
        {!helpDismissed && <Pressable accessibilityRole="button" accessibilityLabel={t("Como funciona")} onPress={onHelp} style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}>
          <Icon name="shield" size={23} color={C.accent} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={s.between}><Text style={s.h3}>{t("Como funciona")}</Text><View style={styles.tipBadge}><Text style={styles.tipText}>{t("Dica")}</Text></View></View>
            <Text style={s.body}>{t("Imprima o QR ou grave uma etiqueta NFC.")}</Text>
          </View>
        </Pressable>}
        {openReports.length > 0 && <Pressable accessibilityRole="button" onPress={() => switchTab('messages')} style={({ pressed }) => [styles.alert, pressed && styles.pressed]}>
          <View style={[s.circle, { backgroundColor: C.soft }]}><Icon name="message-circle" color={C.accent} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{t("Tem um reencontro a caminho")}</Text><Text style={s.small}>{conversationCount(t, openReports.length, locale)}</Text></View><Icon name="chevron-right" color={C.muted} />
        </Pressable>}
        {tags.length > 0 ? <View>
          <View style={[s.between, { marginBottom: 10 }]}><Text style={s.h2}>{t("Objetos")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Ver todos")} onPress={() => browseTags('all')} style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}><Text style={s.body}>{t("Ver todos")}</Text><Icon name="chevron-right" size={20} color={C.muted} /></Pressable></View>
          {homeTags.length > 0 ? homeTags.map((tag, index) => <TagRow key={tag.id} tag={tag} last={index === homeTags.length - 1} onPress={() => setSelected(tag)} />) : <View style={s.empty}>
            <View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="box" size={32} /></View>
            <Text style={[s.h2, styles.center]}>{t("Nenhum objeto protegido ou perdido")}</Text>
            <Text style={[s.body, styles.center]}>{t("Os objetos reencontrados e arquivados continuam na aba Objetos. Use os filtros para vê-los.")}</Text>
          </View>}
        </View> : <View style={s.empty}>
          <View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="tag" size={32} /></View>
          <Text style={[s.h2, styles.center]}>{t("Seu primeiro objeto")}</Text>
          <Text style={[s.body, styles.center]}>{t("Adicione um objeto e crie um QR para ajudar quem o encontrar a falar com você.")}</Text>
        </View>}

      </> : <>
        {reports.length > 0 && <Text accessibilityRole="header" style={s.h1}>{t("Conversas")}</Text>}
        {reports.length > 0 ? <View>{reports.map(report => <Pressable key={report.id} accessibilityRole="button" accessibilityLabel={t("Conversa sobre {name}", { name: report.tagName })} onPress={() => { setFinderChat(false); setChat(report.id); }} style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <View style={s.circle}><Icon name={report.status === 'resolved' ? 'check' : 'message-circle'} color={report.status === 'resolved' ? C.green : C.ink} /></View>
          <View style={{ flex: 1, gap: 6 }}><Text numberOfLines={2} style={s.h3}>{report.tagName}</Text><Text style={s.small}>{report.finderName} · {report.status === 'resolved' ? t("Devolvido") : t("Em conversa")}</Text><Text numberOfLines={1} style={s.body}>{report.lastMessage}</Text><Text style={s.small}>{formatDate(report.updatedAt, locale)}</Text></View><Icon name="chevron-right" color={C.muted} size={22} />
        </Pressable>)}</View> : <View style={[s.empty, { flex: 1 }]}><View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="message-circle" size={32} /></View><Text style={[s.h2, styles.center]}>{t("Tudo tranquilo por aqui")}</Text><Text style={[s.body, styles.center]}>{t("Quando alguém escanear sua etiqueta e enviar um aviso, a conversa aparece aqui.")}</Text></View>}
      </>}
      </View>
    </KeyboardAwareScrollView>
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={styles.bottomFade}>
      <Svg width="100%" height="100%"><Defs><LinearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={C.bg} stopOpacity={0} /><Stop offset="0.7" stopColor={C.bg} stopOpacity={0.9} /><Stop offset="1" stopColor={C.bg} /></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#bottomFade)" /></Svg>
    </View>
    </View>
    ); })}
    <View style={[StyleSheet.absoluteFill, { opacity: tab === 'tags' ? 1 : 0 }]} pointerEvents={tab === 'tags' ? 'auto' : 'none'} accessibilityElementsHidden={tab !== 'tags' || account || notificationsOpen} importantForAccessibility={tab !== 'tags' || account || notificationsOpen ? 'no-hide-descendants' : 'auto'}>
      <ObjectsScreen active={tab === 'tags'} filterRevision={browseRevision} embedded initialFilter={browsing} tags={tags} onSelect={setSelected} onAdd={() => setForm('new')} onClose={() => switchTab('items')} refreshing={refreshing} loading={initialLoading} onRefresh={() => void refresh()} error={error} covered={tab !== 'tags' || !!selected || !!form || !!chat || account || notificationsOpen} suspended={!!form} />
    </View>
    </View>
    <View style={styles.navigation} accessibilityElementsHidden={!!(account || notificationsOpen || selected || form || chat)} importantForAccessibility={account || notificationsOpen || selected || form || chat ? "no-hide-descendants" : "auto"}>{tabs.map(tabItem => <Pressable key={tabItem.key} testID={`tab-${tabItem.key}`} accessibilityRole="tab" accessibilityLabel={t(tabItem.label)} accessibilityState={{ selected: tab === tabItem.key }} onPress={() => switchTab(tabItem.key)} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View style={styles.tabIcon}>
        {!account && tab === tabItem.key && <View pointerEvents="none" style={styles.tabSelection} />}
        <Icon name={tabItem.icon} color={!account && tab === tabItem.key ? C.onPrimary : C.ink} size={28} />{tabItem.key === 'messages' && inbox.unreadCount > 0 && <View style={styles.badge} />}
      </View>
      <Text style={{ color: C.ink, fontSize: 12, fontWeight: tab === tabItem.key ? '600' : '400' }}>{t(tabItem.label)}</Text>
    </Pressable>)}</View>
    {notificationsOpen && <PageLayer><NotificationsScreen covered={!!chat || !!selected || !!form} onClose={() => setNotificationsOpen(false)} /></PageLayer>}
    {account && <PageLayer><Account token={token} user={user} onUserUpdated={onUserUpdated} onClose={() => setAccount(false)} onHelp={onHelp} onLogout={onLogout} /></PageLayer>}
    {chat && <Sheet title={t('Conversa')} scrollable={false} onClose={() => setChat(undefined)}>
      <Conversation key={chat} id={chat} token={token} finder={finderChat} covered={!!selected} onViewItem={!finderChat ? report => {
        setConversationTagId(report.id); setSelectedId(report.tagId);
        void invalidateApiResources(token, ['/tags', '/reports']);
      } : undefined} />
    </Sheet>}
    {selected && <TagDetails covered={!!form} tag={selected} token={token} user={user} onUserUpdated={onUserUpdated} conversation={conversationTag?.tagId === selected.id ? conversationTag : undefined} onClose={() => { setSelected(undefined); setConversationTagId(undefined); }} onUpdated={saveTag} onResolved={() => finishReturn(selected.id)} onEdit={(tag, reward = false) => { setRewardOnly(reward); setForm(tag.id); }} onTransferred={() => { setSelected(undefined); setConversationTagId(undefined); void refresh(); }} />}
    {form && <TagForm rewardOnly={rewardOnly} token={token} user={user} onUserUpdated={onUserUpdated} tag={formTag} onClose={() => { setForm(null); setRewardOnly(false); }} onSaved={tag => { saveTag(tag); setForm(null); setRewardOnly(false); }} />}
  </View>;
}

function DashboardSkeleton() {
  const { C, t } = useUI();
  const block = { backgroundColor: C.surface, borderRadius: 12 } as const;
  return <View accessibilityLabel={t("Carregando objetos")} style={{ gap: 26 }}>
    <View style={[block, { width: 190, height: 38 }]} />
    <View style={{ flexDirection: 'row', gap: 16 }}>
      {[0, 1, 2].map(index => <View key={index} style={{ flex: 1, gap: 8 }}><View style={[block, { width: 44, height: 32 }]} /><View style={[block, { width: '82%', height: 18 }]} /></View>)}
    </View>
    <View style={[block, { height: 54, borderRadius: 18 }]} />
    <View style={[block, { height: 106, borderRadius: 24 }]} />
    <View style={{ gap: 18 }}>
      <View style={[block, { width: 120, height: 26 }]} />
      {[0, 1, 2].map(index => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}><View style={[block, { width: 48, height: 48, borderRadius: 16 }]} /><View style={{ flex: 1, gap: 8 }}><View style={[block, { width: `${62 - index * 8}%`, height: 20 }]} /><View style={[block, { width: '42%', height: 15 }]} /></View></View>)}
    </View>
  </View>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' }, topBar: { position: 'absolute', top: 0, width: '100%', maxWidth: 720, alignSelf: 'center', zIndex: 2, backgroundColor: C.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  scrollContent: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 84, gap: 26 }, center: { textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 16 }, stat: { flex: 1, gap: 5 }, statValue: { color: C.ink, fontSize: 28, fontWeight: '500', lineHeight: 34 }, statLabel: { color: C.muted, fontSize: 14, lineHeight: 21 },
  viewAll: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 22, minHeight: 106, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  helpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 18, backgroundColor: C.surface, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  tipBadge: { backgroundColor: C.raised, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  tipText: { color: C.ink, fontSize: 12, fontWeight: '500' },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 64 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }, pressed: { opacity: 0.65 },
  navigation: { flexDirection: 'row', backgroundColor: C.bg, paddingTop: 12, paddingBottom: 8 }, tab: { flex: 1, alignItems: 'center', gap: 6, minHeight: 56 },
  tabIcon: { width: 72, height: 52, alignItems: 'center', justifyContent: 'center' },
  // Mount the rounded background with its final color so Android preserves its corners when switching tabs.
  tabSelection: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20, backgroundColor: C.primary },
  notificationBadge: { position: 'absolute', right: 0, top: 0, minWidth: 18, height: 18, paddingHorizontal: 4, backgroundColor: C.accent, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  notificationBadgeText: { color: C.onAccent, fontSize: 10, fontWeight: '700' },
  badge: { position: 'absolute', top: 8, right: 15, width: 8, height: 8, backgroundColor: C.accent, borderRadius: 4 },
});
