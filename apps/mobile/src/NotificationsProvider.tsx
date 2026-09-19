import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { api, API_URL, ApiError } from './api';
import { usePreferences } from './PreferencesProvider';
import { useUI } from './ui';
import { Notifications, prepareNotifications, registerPush } from './platform/notifications';
import { secureStorage } from './platform/storage';
import { InboxNotification, newNotifications, NotificationInbox, notificationTarget, NotificationTarget } from './notifications.model';

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
  const [inbox, setInbox] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const activeReport = useRef<string | undefined>(undefined);
  const seen = useRef<number | null>(null);
  const identity = `${apiOrigin}:${userId || ''}:${token || ''}`;
  const current = useRef(identity); current.current = identity;
  const latest = useRef({ onOpen, t, permission, pushReady }); latest.current = { onOpen, t, permission, pushReady };
  const fetching = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async (showLoading = false) => {
    if (!token || !userId || fetching.current) return;
    if (showLoading) setLoading(true);
    fetching.current = true;
    const version = revision.current;
    try {
      const data = await api<NotificationInbox>('/notifications', token);
      if (current.current !== identity || version !== revision.current) return;
      setInbox(previous => ({ ...data,
        notifications: [...data.notifications, ...previous.notifications.filter(item => item.id < (data.notifications.at(-1)?.id || 0))],
        nextCursor: previous.latestId === data.latestId && previous.notifications.length > 50 ? previous.nextCursor : data.nextCursor,
      })); setError('');
      if (seen.current !== null && latest.current.permission && !latest.current.pushReady && AppState.currentState === 'active') {
        // Old history belongs in the inbox, not in a burst of system alerts.
        const arrivals = newNotifications(data.notifications, seen.current, activeReport.current).slice(0, 3).reverse();
        for (const item of arrivals) {
          if (current.current !== identity) return;
          await Notifications.scheduleNotificationAsync({ identifier: `message-${userId}-${item.id}`,
            content: { title: `${latest.current.t('Nova mensagem')} · ${item.tagName}`, body: item.body.slice(0, 240), sound: 'default',
              data: { messageId: item.id, reportId: item.reportId, userId, finder: item.finder, apiOrigin } }, trigger: { channelId: 'messages' } });
        }
      }
      if (current.current === identity) seen.current = Math.max(seen.current || 0, data.latestId);
    } catch (cause) { if (current.current === identity) setError(cause instanceof ApiError && cause.status === 404 ? latest.current.t('As notificações ainda não estão disponíveis neste servidor.') : (cause as Error).message); }
    finally { if (current.current === identity) { fetching.current = false; setLoading(false); } }
  }, [token, userId, identity]);

  useEffect(() => {
    setInbox(empty); setError(''); seen.current = null; fetching.current = false; activeReport.current = undefined;
    setLoading(!!token && !!userId);
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 5000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh]);

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

  useEffect(() => {
    Notifications.setNotificationHandler({ handleNotification: async notification => {
      const target = userId ? notificationTarget(notification.request.content.data || {}, userId, apiOrigin) : null;
      const show = !!target && target.reportId !== activeReport.current;
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    } });
    const receive = Notifications.addNotificationReceivedListener(() => { void refresh(); });
    const open = (response: Notifications.NotificationResponse) => {
      if (!userId) return;
      const target = notificationTarget(response.notification.request.content.data || {}, userId, apiOrigin);
      void Notifications.clearLastNotificationResponseAsync();
      if (target) latest.current.onOpen(target);
    };
    const response = Notifications.getLastNotificationResponse();
    if (response && userId) open(response);
    const tap = Notifications.addNotificationResponseReceivedListener(open);
    return () => { receive.remove(); tap.remove(); Notifications.setNotificationHandler(null); };
  }, [userId, refresh]);

  const markRead = useCallback(async (throughId: number, reportId?: string) => {
    if (!token || !userId || !throughId) return false;
    const version = ++revision.current;
    try {
      const data = await api<NotificationInbox>('/notifications/read', token, { throughId, ...(reportId ? { reportId } : {}) });
      if (current.current === identity && version === revision.current) {
        setInbox(previous => ({ ...data, notifications: [...data.notifications,
          ...previous.notifications.filter(item => item.id < (data.notifications.at(-1)?.id || 0)).map(item =>
            item.id <= throughId && (!reportId || item.reportId === reportId) ? { ...item, read: true } : item)],
          nextCursor: previous.notifications.length > 50 ? previous.nextCursor : data.nextCursor }));
        setError('');
        const presented = await Notifications.getPresentedNotificationsAsync();
        for (const item of presented) {
          const target = notificationTarget(item.request.content.data || {}, userId, apiOrigin);
          if (target && target.messageId <= throughId && (!reportId || target.reportId === reportId)) await Notifications.dismissNotificationAsync(item.request.identifier);
        }
      }
      return true;
    } catch (cause) { if (current.current === identity) setError((cause as Error).message); return false; }
  }, [token, userId, identity]);
  async function loadMore() {
    if (!token || !inbox.nextCursor || loading) return;
    setLoading(true);
    const version = revision.current;
    try {
      const data = await api<NotificationInbox>(`/notifications?before=${inbox.nextCursor}`, token);
      if (current.current === identity && version === revision.current) setInbox(previous => ({ ...previous, nextCursor: data.nextCursor, notifications: [...previous.notifications, ...data.notifications.filter(item => !previous.notifications.some(existing => existing.id === item.id))] }));
    } catch (cause) { if (current.current === identity) setError((cause as Error).message); }
    finally { if (current.current === identity) setLoading(false); }
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
  return <Context.Provider value={{ ...inbox, loading, error, permission, pushReady, refresh: () => refresh(true), loadMore, enable, markRead,
    setActiveReport: useCallback((id?: string) => { activeReport.current = id; }, []), open }}>{children}</Context.Provider>;
}
export function useNotifications() {
  const value = useContext(Context);
  if (!value) throw new Error('NotificationsProvider is required');
  return value;
}
