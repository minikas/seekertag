import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { apiQueryKey } from './query';
import { api, API_URL, ApiError } from './api';
import { usePreferences } from './PreferencesProvider';
import { useUI } from './ui';
import { Notifications, prepareNotifications, registerPush } from './platform/notifications';
import { secureStorage } from './platform/storage';
import { InboxNotification, newNotifications, NotificationInbox, notificationTarget, NotificationTarget, notificationInbox, updateReadNotifications } from './notifications.model';

const empty: NotificationInbox = { notifications: [], unreadCount: 0, latestId: 0, nextCursor: null };
type Value = NotificationInbox & { loading: boolean; error: string; permission: boolean; pushReady: boolean;
  refresh: () => Promise<void>; loadMore: () => Promise<void>; enable: () => Promise<void>;
  markRead: (throughId: number, reportId?: string) => Promise<boolean>; setActiveReport: (id?: string) => void;
  open: (item: InboxNotification) => void };
const Context = createContext<Value | null>(null);
const apiOrigin = new URL(API_URL).origin;

export function NotificationsProvider({ token, userId, onOpen, children }: PropsWithChildren<{
  token: string | null; userId?: string; onOpen: (target: NotificationTarget) => void;
}>) {
  const { language } = usePreferences();
  const { t } = useUI();
  const queryClient = useQueryClient();
  const [actionError, setError] = useState('');
  const [permission, setPermission] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const activeReport = useRef<string | undefined>(undefined);
  const seen = useRef<number | null>(null);
  const identity = `${apiOrigin}:${userId || ''}:${token || ''}`;
  const current = useRef(identity); current.current = identity;
  const latest = useRef({ onOpen, t, permission, pushReady }); latest.current = { onOpen, t, permission, pushReady };
  const revision = useRef(0);
  const inboxQuery = useInfiniteQuery({
    queryKey: apiQueryKey(token, '/notifications'),
    enabled: !!token && !!userId,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) => api<NotificationInbox>(pageParam ? `/notifications?before=${pageParam}` : '/notifications', token, undefined, undefined, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchInterval: 5000,
  });
  const inbox = useMemo(() => token && userId && inboxQuery.data ? notificationInbox(inboxQuery.data.pages) : empty, [token, userId, inboxQuery.data]);
  const loading = !!token && !!userId && (inboxQuery.isLoading || inboxQuery.isFetchingNextPage);
  const error = actionError || (inboxQuery.error instanceof ApiError && inboxQuery.error.status === 404
    ? t('As notificações ainda não estão disponíveis neste servidor.') : inboxQuery.error?.message || '');
  const refresh = useCallback(async () => {
    if (!token || !userId) return;
    await inboxQuery.refetch({ cancelRefetch: false });
  }, [token, userId, inboxQuery.refetch]);
  useEffect(() => {
    setError(''); seen.current = null; activeReport.current = undefined; revision.current++;
  }, [identity]);
  useEffect(() => {
    const first = inboxQuery.data?.pages[0];
    if (!first || !token || !userId) return;
    const after = seen.current;
    // Advance before awaiting the OS so polling cannot schedule an alert twice.
    seen.current = Math.max(after || 0, first.latestId);
    if (after === null || !latest.current.permission || latest.current.pushReady || AppState.currentState !== 'active') return;
    const arrivals = newNotifications(first.notifications, after, activeReport.current).slice(0, 3).reverse();
    void (async () => {
      for (const item of arrivals) {
        if (current.current !== identity) return;
        await Notifications.scheduleNotificationAsync({ identifier: `message-${userId}-${item.id}`,
          content: { title: `${latest.current.t(item.kind === 'wallet_confirmed' ? 'Carteira de recebimento confirmada.' : 'Nova mensagem')} · ${item.tagName}`, body: (item.kind === 'wallet_confirmed' ? latest.current.t(item.body) : item.body).slice(0, 240), sound: 'default',
            data: { messageId: item.id, reportId: item.reportId, userId, finder: item.finder, apiOrigin } }, trigger: { channelId: 'messages' } });
      }
    })().catch(() => {});
  }, [inboxQuery.data, identity, token, userId]);

  useEffect(() => {
    let live = true;
    setPushReady(false);
    async function configure(request: boolean, deviceToken?: Notifications.DevicePushToken) {
      try {
        const result = await prepareNotifications(request);
        if (!live) return;
        setPermission(result.granted);
        if (token && userId && result.granted) {
          const registered = await registerPush(token, language, deviceToken);
          if (live) setPushReady(registered);
        }
      } catch { if (live) setPushReady(false); }
    }
    if (token && userId) {
      void secureStorage.get('notification-permission-requested').then(async value => {
        if (!live) return;
        await configure(value !== '1');
        await secureStorage.set('notification-permission-requested', '1');
      }).catch(() => {});
    }
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void configure(false); });
    const pushSub = Notifications.addPushTokenListener(deviceToken => { void configure(false, deviceToken); });
    return () => { live = false; sub.remove(); pushSub.remove(); };
  }, [token, userId, language]);

  const handledResponse = useRef<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    Notifications.setNotificationHandler({ handleNotification: async notification => {
      const target = userId ? notificationTarget(notification.request.content.data || {}, userId, apiOrigin) : null;
      const show = !!target && (AppState.currentState !== 'active' || target.reportId !== activeReport.current);
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    } });
    const receive = Notifications.addNotificationReceivedListener(() => { void refresh(); });
    const open = (response: Notifications.NotificationResponse) => {
      // A cold-start response can arrive before the account is restored. Leave
      // it pending until this effect runs with the authenticated account.
      if (!live || !token || !userId) return;
      const target = notificationTarget(response.notification.request.content.data || {}, userId, apiOrigin);
      if (!target) return;
      const responseKey = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handledResponse.current === responseKey) return;
      handledResponse.current = responseKey;
      latest.current.onOpen(target);
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const tap = Notifications.addNotificationResponseReceivedListener(open);
    const response = Notifications.getLastNotificationResponse();
    if (response) open(response);
    // Android may finish exposing its launch intent after the synchronous read.
    void Notifications.getLastNotificationResponseAsync().then(response => { if (response) open(response); }).catch(() => {});
    return () => { live = false; receive.remove(); tap.remove(); Notifications.setNotificationHandler(null); };
  }, [token, userId, refresh]);

  const readMutation = useMutation({
    mutationFn: ({ token: session, throughId, reportId }: { token: string; throughId: number; reportId?: string }) => api<NotificationInbox>('/notifications/read', session, { throughId, ...(reportId ? { reportId } : {}) }),
  });
  const markRead = useCallback(async (throughId: number, reportId?: string) => {
    if (!token || !userId || !throughId) return false;
    const version = ++revision.current;
    try {
      // Do not let a poll started before the receipt restore an unread badge.
      await queryClient.cancelQueries({ queryKey: apiQueryKey(token, '/notifications'), exact: true });
      const data = await readMutation.mutateAsync({ token, throughId, reportId });
      if (current.current === identity && version === revision.current) {
        queryClient.setQueryData<InfiniteData<NotificationInbox, number | undefined>>(apiQueryKey(token, '/notifications'), previous => ({
          pageParams: previous?.pageParams || [undefined],
          pages: updateReadNotifications(previous?.pages || [], data, throughId, reportId),
        }));
        setError('');
        const presented = await Notifications.getPresentedNotificationsAsync();
        for (const item of presented) {
          const target = notificationTarget(item.request.content.data || {}, userId, apiOrigin);
          if (target && target.messageId <= throughId && (!reportId || target.reportId === reportId)) await Notifications.dismissNotificationAsync(item.request.identifier);
        }
      }
      return true;
    } catch (cause) { if (current.current === identity) setError((cause as Error).message); return false; }
  }, [token, userId, identity, queryClient, readMutation.mutateAsync]);
  async function loadMore() {
    if (!token || !inboxQuery.hasNextPage || inboxQuery.isFetching) return;
    await inboxQuery.fetchNextPage({ cancelRefetch: false });
  }
  async function enable() {
    try {
      const result = await prepareNotifications(true);
      setPermission(result.granted);
      if (!result.granted && !result.canAskAgain) await Linking.openSettings();
      if (result.granted && token && userId) setPushReady(await registerPush(token, language));
      setError('');
    } catch { setError(t('Não foi possível ativar os avisos. Tente novamente.')); }
  }
  function open(item: InboxNotification) {
    if (userId) latest.current.onOpen({ messageId: item.id, reportId: item.reportId, userId, finder: item.finder, apiOrigin });
  }
  return <Context.Provider value={{ ...inbox, loading, error, permission, pushReady, refresh, loadMore, enable, markRead,
    setActiveReport: useCallback((id?: string) => { activeReport.current = id; }, []), open }}>{children}</Context.Provider>;
}
export function useNotifications() {
  const value = useContext(Context);
  if (!value) throw new Error('NotificationsProvider is required');
  return value;
}
