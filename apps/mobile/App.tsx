import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QueryProvider from './src/QueryProvider';
import { apiQueryKey, apiQueryOptions, queryClient, resetApiCache } from './src/query';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { PortalHost } from '@gorhom/portal';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ConversationDraftProvider, NavigationProvider, PageLayer, useNavigationState } from './src/Navigation';
import { FieldHelpInteractionProvider } from './src/FieldHelpInteractions';
import Auth from './src/Auth';
import { PreferencesProvider, usePreferences } from './src/PreferencesProvider';
import Dashboard from './src/Dashboard';
import { NotificationsProvider } from './src/NotificationsProvider';
import type { NotificationTarget } from './src/notifications.model';
import { Notifications } from './src/platform/notifications';
import Found from './src/Found';
import HelpSheet from './src/HelpSheet';
import { api, API_URL, ApiError, User } from './src/api';
import { secureStorage, tokenStorage } from './src/platform/storage';
import { QrScanner } from './src/platform/QrScanner';
import { Brand, Button, Notice, Sheet, useUI } from './src/ui';
import { readRoute, Route } from './src/links';
import { isAuthCallback } from './src/platform/auth';
import { forgetWalletAuthorization } from './src/platform/wallet';

function Content() {
  const { C, s, t } = useUI();
  const { dark } = usePreferences();
  const navigation = useNavigationState();
  const [pendingRoute, setPendingRoute] = useState<Route>();
  const [notification, setNotification] = useState<NotificationTarget>();
  const [route, setRoute] = useState<Route>({});
  const [token, setToken] = useState<string | null>(null); const [restoring, setRestoring] = useState(true); const [scan, setScan] = useState(false); const [help, setHelp] = useState(false); const [helpDismissed, setHelpDismissed] = useState(false); const [recovery, setRecovery] = useState<string>(); const [error, setError] = useState('');
  const profile = useQuery({ ...apiQueryOptions<{ user: User }>('/auth/me', token), enabled: !!token && !restoring });
  const user = token ? profile.data?.user : undefined;
  const loading = restoring || (!!token && profile.isPending && !profile.isPaused);
  const setUser = (person: User) => queryClient.setQueryData(apiQueryKey(token, '/auth/me'), { user: person });
  function expireSession() {
    void tokenStorage.clear(); forgetWalletAuthorization(); resetApiCache();
    setToken(null); setNotification(undefined); setRecovery(undefined);
    setError(t("Sua sessão terminou. Entre novamente para continuar."));
  }
  function navigate(destination: Route) { setRoute(destination); setError(''); }
  useEffect(() => {
    let live = true;
    let receivedLink = false;
    const open = (url: string) => {
      if (isAuthCallback(url)) return;
      const destination = readRoute(url, API_URL);
      if (destination) { setPendingRoute(destination); setError(''); }
      else if (url.startsWith('seekertag:')) setError(t("Este link não é desta instalação do SeekerTag."));
    };
    const sub = Linking.addEventListener('url', event => { receivedLink = true; open(event.url); });
    void Linking.getInitialURL().then(url => { if (live && !receivedLink && url) open(url); }).catch(() => { if (live) setError(t("Não foi possível abrir o link. Escaneie a etiqueta no aplicativo.")); });
    return () => { live = false; sub.remove(); };
  }, []);
  useEffect(() => { void secureStorage.get('help-dismissed-v1').then(value => setHelpDismissed(value === '1')); }, []);
  async function dismissHelpForever() { await secureStorage.set('help-dismissed-v1', '1'); setHelpDismissed(true); setHelp(false); }
  useEffect(() => {
    if (!pendingRoute || notification || navigation.tasks || scan || help || recovery || route.code || route.chatId) return;
    setRoute(pendingRoute); setPendingRoute(undefined);
  }, [pendingRoute, notification, navigation.tasks, scan, help, recovery, route.code, route.chatId]);
  useEffect(() => {
    let live = true;
    void tokenStorage.get().then(saved => { if (live) setToken(saved); })
      .catch(cause => { if (live) setError((cause as Error).message); })
      .finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!token || !profile.error) return;
    if (profile.error instanceof ApiError && profile.error.status === 401) expireSession();
  }, [token, profile.error]);
  // A deliberate notification tap takes precedence over passive link state.
  // Leave recovery codes and a finder task with unsaved work mounted until closed.
  useEffect(() => {
    if (!notification || recovery || ((route.code || route.chatId) && navigation.tasks)) return;
    setRoute({}); setPendingRoute(undefined); setScan(false); setHelp(false);
  }, [notification, recovery, route.code, route.chatId, navigation.tasks]);
  async function login(value: string, person: User, code?: string) {
    await tokenStorage.set(value);
    if (value !== token) resetApiCache();
    queryClient.setQueryData(apiQueryKey(value, '/auth/me'), { user: person });
    setToken(value); setError(''); setRecovery(code);
  }
  async function logout() {
    try { await api('/auth/logout', token, {}); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; }
    await tokenStorage.clear(); forgetWalletAuthorization();
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
    resetApiCache(); setNotification(undefined); setRoute({}); setPendingRoute(undefined); setToken(null); setRecovery(undefined);
  }
  const displayError = error || (token ? profile.error?.message : '') || (token && !user && profile.isPaused ? 'Não foi possível conectar. Verifique sua conexão e tente novamente.' : '');
  function scanResult(url: string) { setScan(false); const destination = readRoute(url, API_URL); if (destination?.code) navigate(destination); else setError('Este QR não é uma etiqueta desta instalação do SeekerTag. Confira se está usando o link correto.'); }
  return <NotificationsProvider token={token} userId={user?.id} onOpen={setNotification}><ConversationDraftProvider key={user?.id || "guest"}><BottomSheetModalProvider><SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><StatusBar style={dark ? "light" : "dark"} />
    <View style={{ flex: 1 }}>
    {!!displayError && <View style={{ padding: 12 }}><Notice error text={displayError} /></View>}
    <View style={{ flex: 1 }} pointerEvents={route.code || route.chatId || scan || help || recovery ? "none" : "auto"} accessibilityElementsHidden={!!(route.code || route.chatId || scan || help || recovery)} importantForAccessibility={route.code || route.chatId || scan || help || recovery ? "no-hide-descendants" : "auto"}>
    {loading ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24 }}><Brand /><ActivityIndicator color={C.accent} /></View> : token && user ? <Dashboard key={user.id} notification={route.code || route.chatId || scan || help || recovery ? undefined : notification} onNotificationOpened={() => setNotification(current => current === notification ? undefined : current)} token={token} user={user} onUserUpdated={setUser} onLogout={logout} onScan={() => setScan(true)} onHelp={() => setHelp(true)} helpDismissed={helpDismissed} onExpired={expireSession} /> : token ? <View style={{ padding: 24 }}><Button onPress={() => void profile.refetch()}>{t("Tentar novamente")}</Button></View> : <Auth onAuth={login} onScan={() => setScan(true)} />}
    </View>
    {!loading && (route.code || route.chatId) && <PageLayer><Found token={token} key={route.code || route.chatId} code={route.code} chatId={route.chatId} goHome={() => navigate({})} goChat={id => navigate({ ...route, chatId: id })} onAuth={login} /></PageLayer>}
    {scan && <QrScanner onScan={scanResult} onClose={() => setScan(false)} />}
    {help && <HelpSheet onClose={() => setHelp(false)} onDismissForever={() => void dismissHelpForever()} />}
    {recovery && <Sheet title={t("Guarde sua chave de recuperação.")} subtitle={t("Ela permite recuperar a conta se você esquecer a senha.")} dismissible={false} onClose={() => {}}><Text style={s.body}>{t("Salve este código em um gerenciador de senhas ou anote em um lugar seguro. Ele aparece apenas agora.")}</Text><Text selectable style={{ fontSize: 19, color: C.ink, backgroundColor: C.surface, padding: 19, borderRadius: 12, lineHeight: 30 }}>{recovery}</Text><Button icon="check" onPress={() => setRecovery(undefined)}>{t("Já guardei meu código")}</Button></Sheet>}
    </View>
  </SafeAreaView><PortalHost name="field-help" /></BottomSheetModalProvider></ConversationDraftProvider></NotificationsProvider>;
}
function AppFrame() {
  const { C } = useUI();
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
    <SafeAreaProvider><KeyboardProvider statusBarTranslucent navigationBarTranslucent><FieldHelpInteractionProvider><NavigationProvider><Content /></NavigationProvider></FieldHelpInteractionProvider></KeyboardProvider></SafeAreaProvider>
  </GestureHandlerRootView>;
}

export default function App() {
  return <QueryProvider><PreferencesProvider><AppFrame /></PreferencesProvider></QueryProvider>;
}
