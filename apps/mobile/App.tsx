import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import Auth from './src/Auth';
import { PreferencesProvider, usePreferences } from './src/PreferencesProvider';
import Dashboard from './src/Dashboard';
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
  const { C, s, t, locale } = useUI();
  const { dark } = usePreferences();
  const [route, setRoute] = useState<Route>({});
  const [token, setToken] = useState<string | null>(null); const [user, setUser] = useState<User>(); const [loading, setLoading] = useState(true); const [scan, setScan] = useState(false); const [help, setHelp] = useState(false); const [helpDismissed, setHelpDismissed] = useState(false); const [recovery, setRecovery] = useState<string>(); const [error, setError] = useState('');
  function navigate(destination: Route) { setRoute(destination); setError(''); }
  useEffect(() => {
    let live = true;
    let receivedLink = false;
    const open = (url: string) => {
      if (isAuthCallback(url)) return;
      const destination = readRoute(url, API_URL);
      if (destination) { setRoute(destination); setError(''); }
      else if (url.startsWith('seekertag:')) setError(t("Este link não é desta instalação do SeekerTag."));
    };
    const sub = Linking.addEventListener('url', event => { receivedLink = true; open(event.url); });
    void Linking.getInitialURL().then(url => { if (live && !receivedLink && url) open(url); }).catch(() => { if (live) setError(t("Não foi possível abrir o link. Escaneie a etiqueta no aplicativo.")); });
    return () => { live = false; sub.remove(); };
  }, []);
  useEffect(() => { void secureStorage.get('help-dismissed-v1').then(value => setHelpDismissed(value === '1')); }, []);
  async function dismissHelpForever() { await secureStorage.set('help-dismissed-v1', '1'); setHelpDismissed(true); setHelp(false); }
  useEffect(() => {
    if (!route.code && !route.chatId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { navigate({}); return true; });
    return () => sub.remove();
  }, [route.code, route.chatId]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const saved = await tokenStorage.get();
        if (saved) {
          // Retain the session on a transient profile-fetch failure. A cold QR
          // link must not silently treat a signed-in owner as an anonymous finder.
          if (live) setToken(saved);
          const { user: person } = await api<{ user: User }>('/auth/me', saved);
          if (live) setUser(person);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await tokenStorage.clear();
          if (live) { setToken(null); setUser(undefined); }
        } else if (live) setError((e as Error).message);
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);
  async function login(value: string, person: User, code?: string) { await tokenStorage.set(value); setToken(value); setUser(person); setError(''); setRecovery(code); }
  async function logout() { try { await api('/auth/logout', token, {}); } catch(e) { if (!(e instanceof ApiError && e.status === 401)) throw e; } await tokenStorage.clear(); forgetWalletAuthorization(); setToken(null); setUser(undefined); }
  function scanResult(url: string) { setScan(false); const destination = readRoute(url, API_URL); if (destination?.code) navigate(destination); else setError('Este QR não é uma etiqueta desta instalação do SeekerTag. Confira se está usando o link correto.'); }
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><StatusBar style={dark ? "light" : "dark"} />
    {!!error && <View style={{ padding: 12 }}><Notice error text={error} /></View>}
    {loading ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24 }}><Brand /><ActivityIndicator color={C.accent} /></View> : route.code || route.chatId ? <Found token={token} key={route.code || route.chatId} code={route.code} chatId={route.chatId} goHome={() => navigate({})} goChat={id => navigate({ chatId: id })} /> : token && user ? <Dashboard key={user.id} token={token} user={user} onUserUpdated={setUser} onLogout={logout} onScan={() => setScan(true)} onHelp={() => setHelp(true)} helpDismissed={helpDismissed} onExpired={() => { void tokenStorage.clear(); setToken(null); setUser(undefined); setError(t("Sua sessão terminou. Entre novamente para continuar.")); }} /> : <Auth onAuth={login} onScan={() => setScan(true)} />}
    {scan && <QrScanner onScan={scanResult} onClose={() => setScan(false)} />}
    {help && <HelpSheet onClose={() => setHelp(false)} onDismissForever={() => void dismissHelpForever()} />}
    {recovery && <Sheet title={t("Guarde sua chave de recuperação.")} subtitle={t("Ela permite recuperar a conta se você esquecer a senha.")} dismissible={false} onClose={() => {}}><Text style={s.body}>{t("Salve este código em um gerenciador de senhas ou anote em um lugar seguro. Ele aparece apenas agora.")}</Text><Text selectable style={{ fontSize: 19, color: C.ink, backgroundColor: C.surface, padding: 19, borderRadius: 12, lineHeight: 30 }}>{recovery}</Text><Button icon="check" onPress={() => setRecovery(undefined)}>{t("Já guardei meu código")}</Button></Sheet>}
  </SafeAreaView>;
}
function AppFrame() {
  const { C } = useUI();
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
    <SafeAreaProvider><KeyboardProvider statusBarTranslucent navigationBarTranslucent><BottomSheetModalProvider><Content /></BottomSheetModalProvider></KeyboardProvider></SafeAreaProvider>
  </GestureHandlerRootView>;
}

export default function App() {
  return <PreferencesProvider><AppFrame /></PreferencesProvider>;
}
