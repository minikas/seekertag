import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, Share, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Auth from './src/Auth';
import Dashboard from './src/Dashboard';
import Found from './src/Found';
import SavedConversations from './src/SavedConversations';
import { finderConversations, listSavedConversations } from './src/finder';
import NotificationsPanel from './src/NotificationsPanel';
import { api, API_URL, ApiError, User } from './src/api';
import { tokenStorage } from './src/platform/storage';
import { QrScanner } from './src/platform/QrScanner';
import { Brand, Button, C, Icon, IconName, Notice, Sheet, s } from './src/ui';

type Route = { kind: 'home' | 'saved' } | { kind: 'found'; code: string } | { kind: 'chat' | 'owner-chat'; id: string };
type Boot = 'loading' | 'retry' | 'ready';
function readRoute(value: string): Route {
  try {
    const url = new URL(value);
    const path = url.protocol === 'seekertag:' ? `/${url.hostname}${url.pathname}` : url.pathname;
    if (/^\/saved\/?$/.test(path)) return { kind: 'saved' };
    const match = /^\/(found|chat|owner-chat)\/([A-Za-z0-9_-]{1,128})\/?$/.exec(path);
    if (match) return match[1] === 'found' ? { kind: 'found', code: match[2] } : { kind: match[1] as 'chat' | 'owner-chat', id: match[2] };
  } catch { /* Unrelated links open home. */ }
  return { kind: 'home' };
}

function SavedShortcut({ onPress }: { onPress: () => void }) {
  const [hasSaved, setHasSaved] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => { void finderConversations.list().then(items => { if (live) setHasSaved(items.length > 0); }).catch(() => {}); };
    const unsubscribe = finderConversations.subscribe(refresh);
    void listSavedConversations().then(items => { if (live) setHasSaved(items.length > 0); }).catch(() => {});
    return () => { live = false; unsubscribe(); };
  }, []);
  return hasSaved ? <Button variant="secondary" icon="message-circle" onPress={onPress}>Minhas conversas</Button> : null;
}

function Content() {
  const [route, setRoute] = useState<Route>(() => Platform.OS === 'web' ? readRoute(globalThis.location.href) : { kind: 'home' });
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User>();
  const [boot, setBoot] = useState<Boot>('loading');
  const [failures, setFailures] = useState(0);
  const [scan, setScan] = useState(false);
  const [help, setHelp] = useState(false);
  const [recovery, setRecovery] = useState<string>();
  const [copyNotice, setCopyNotice] = useState('');
  const [error, setError] = useState('');
  const session = useRef<string | null>(null);
  const authGeneration = useRef(0);
  const bootRef = useRef<Boot>('loading');
  const routeRef = useRef(route);
  const recoveryRef = useRef(recovery);
  routeRef.current = route; recoveryRef.current = recovery;
  const changeBoot = useCallback((next: Boot) => { bootRef.current = next; setBoot(next); }, []);
  const navigate = useCallback((path: string, replace = false) => {
    if (Platform.OS === 'web') {
      if (replace) globalThis.history.replaceState(null, '', path);
      else globalThis.history.pushState(null, '', path);
    }
    const next = readRoute(`https://seekertag.local${path}`);
    routeRef.current = next; setRoute(next); setError('');
  }, []);

  const restoreSession = useCallback(async () => {
    const generation = ++authGeneration.current;
    changeBoot('loading'); setError('');
    let saved: string | null = null;
    try {
      saved = await tokenStorage.get();
      if (generation !== authGeneration.current) return;
      if (saved) {
        const result = await api<{ user: User }>('/auth/me', saved);
        if (generation !== authGeneration.current) return;
        session.current = saved; setToken(saved); setUser(result.user);
      } else { session.current = null; setToken(null); setUser(undefined); }
      setFailures(0); changeBoot('ready');
    } catch (cause) {
      if (generation !== authGeneration.current) return;
      if (cause instanceof ApiError && cause.status === 401 && saved) {
        try { await tokenStorage.clearIfMatches(saved); }
        catch { if (generation === authGeneration.current) { setFailures(previous => previous + 1); changeBoot('retry'); } return; }
        if (generation !== authGeneration.current) return;
        session.current = null; setToken(null); setUser(undefined);
        setError('Sua sessão terminou. Entre novamente para continuar.'); changeBoot('ready');
      } else { setFailures(previous => previous + 1); changeBoot('retry'); }
    }
  }, [changeBoot]);
  useEffect(() => { void restoreSession(); return () => { authGeneration.current++; }; }, [restoreSession]);
  useEffect(() => {
    if (boot !== 'retry') return;
    const timer = setTimeout(() => { if (bootRef.current === 'retry') void restoreSession(); }, Math.min(1000 * 2 ** Math.min(failures, 5), 30_000));
    return () => clearTimeout(timer);
  }, [boot, failures, restoreSession]);
  useEffect(() => {
    const retry = () => { if (bootRef.current === 'retry') void restoreSession(); };
    if (Platform.OS === 'web') {
      globalThis.addEventListener('online', retry); globalThis.addEventListener('focus', retry);
      return () => { globalThis.removeEventListener('online', retry); globalThis.removeEventListener('focus', retry); };
    }
    const sub = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    return () => sub.remove();
  }, [restoreSession]);
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.title = 'SeekerTag';
      const pop = () => { const next = readRoute(location.href); routeRef.current = next; setRoute(next); setError(''); };
      globalThis.addEventListener('popstate', pop); return () => globalThis.removeEventListener('popstate', pop);
    }
    let live = true;
    Linking.getInitialURL().then(value => { if (live && value) setRoute(readRoute(value)); }).catch(() => {});
    const sub = Linking.addEventListener('url', event => setRoute(readRoute(event.url)));
    return () => { live = false; sub.remove(); };
  }, []);

  function showRecovery(code: string) { setCopyNotice(''); setRecovery(code); }
  async function login(value: string, person: User, code?: string) {
    const generation = ++authGeneration.current;
    session.current = value;
    try { await tokenStorage.set(value); }
    catch (cause) { if (generation === authGeneration.current) session.current = null; throw cause; }
    if (generation !== authGeneration.current) return;
    setToken(value); setUser(person); setError(''); setFailures(0); changeBoot('ready');
    if (code) showRecovery(code);
  }
  async function expired(sourceToken: string) {
    if (session.current !== sourceToken) return;
    const generation = authGeneration.current;
    let removed: boolean;
    try { removed = await tokenStorage.clearIfMatches(sourceToken); }
    catch { if (session.current === sourceToken) setError('Não foi possível atualizar o acesso salvo. Tente abrir a conta novamente.'); return; }
    if (!removed || session.current !== sourceToken || generation !== authGeneration.current) return;
    authGeneration.current++;
    session.current = null; setToken(null); setUser(undefined); setRecovery(undefined);
    setError('Sua sessão terminou. Entre novamente para continuar.'); changeBoot('ready');
  }
  async function logout() {
    const sourceToken = session.current;
    if (!sourceToken) return;
    try { await api('/auth/logout', sourceToken, {}); }
    catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) throw cause; }
    await tokenStorage.clearIfMatches(sourceToken);
    if (session.current !== sourceToken) return;
    authGeneration.current++;
    session.current = null; setToken(null); setUser(undefined); setRecovery(undefined); changeBoot('ready'); navigate('/');
  }
  function scanResult(value: string) {
    setScan(false);
    try {
      const scanned = new URL(value); const destination = readRoute(value);
      const origins = [new URL(API_URL).origin, ...(Platform.OS === 'web' ? [globalThis.location.origin] : [])];
      if (destination.kind !== 'found' || scanned.username || scanned.password || !origins.includes(scanned.origin)) throw new Error();
      navigate(`/found/${destination.code}`);
    } catch { setError('Este QR não é uma etiqueta desta instalação do SeekerTag. Abra o link impresso na etiqueta.'); }
  }
  async function saveRecovery() {
    const value = recovery;
    if (!value) return;
    try {
      if (Platform.OS === 'web') {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error();
        await globalThis.navigator.clipboard.writeText(value);
        if (recoveryRef.current === value) setCopyNotice('Código copiado. Guarde-o em um lugar seguro.');
      } else await Share.share({ title: 'Código de recuperação SeekerTag', message: value });
    } catch { if (recoveryRef.current === value) setCopyNotice('Selecione e copie o código abaixo para guardá-lo.'); }
  }

  const saved = <SavedShortcut onPress={() => navigate('/saved')} />;
  let screen: React.ReactNode;
  if (route.kind === 'found' || route.kind === 'chat') {
    screen = <Found key={route.kind === 'found' ? route.code : route.id} code={route.kind === 'found' ? route.code : undefined}
      chatId={route.kind === 'chat' ? route.id : undefined} goHome={() => navigate('/')} goChat={id => navigate(`/chat/${id}`, true)} onSavedConversations={() => navigate('/saved')} />;
  } else if (route.kind === 'saved') {
    screen = <View style={{ flex: 1 }}>
      <View style={[s.between, { padding: 22, maxWidth: 650, width: '100%', alignSelf: 'center' }]}><Brand /><Button variant="ghost" icon="home" label="Página inicial" onPress={() => navigate('/')} /></View>
      <SavedConversations onOpen={id => navigate(`/chat/${id}`)} onClose={() => navigate('/')} />
    </View>;
  } else if (boot !== 'ready') {
    screen = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 22 }}>
      <Brand />
      {boot === 'loading' ? <><ActivityIndicator color={C.purple} /><Text style={s.body}>Abrindo sua conta…</Text></> : <>
        <Text accessibilityRole="header" style={s.h2}>Vamos reconectar.</Text>
        <Text style={[s.body, { textAlign: 'center', maxWidth: 390 }]}>Seu acesso continua salvo. Confira a conexão para abrir seus objetos e conversas.</Text>
        <Button onPress={() => void restoreSession()} icon="refresh-cw">Tentar novamente</Button>
      </>}
      <Button variant="secondary" icon="maximize" onPress={() => setScan(true)}>Encontrei um objeto</Button>
    </View>;
  } else if (token && user) {
    const intendedChat = route.kind === 'owner-chat' ? route.id : undefined;
    screen = <Dashboard key={user.id} token={token} user={user} onLogout={logout} onScan={() => setScan(true)} onHelp={() => setHelp(true)}
      onExpired={sourceToken => void expired(sourceToken)} onRecoveryCode={showRecovery} homeExtras={saved}
      accountExtras={<NotificationsPanel token={token} userId={user.id} email={user.email} />}
      initialChatId={intendedChat} onInitialChatHandled={() => { if (routeRef.current.kind === 'owner-chat' && routeRef.current.id === intendedChat) navigate('/', true); }} />;
  } else screen = <Auth onAuth={login} onScan={() => setScan(true)} savedConversations={saved} />;

  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><StatusBar style="light" />
    {!!error && <View style={{ padding: 12 }}><Notice error text={error} /></View>}{screen}
    {scan && <Modal transparent animationType="fade" onRequestClose={() => { if (Platform.OS !== 'web' && Keyboard.isVisible()) Keyboard.dismiss(); else setScan(false); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={[s.overlay, { flex: 1 }]}>
        <ScrollView style={{ maxWidth: 560, width: '100%', maxHeight: '94%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <QrScanner onScan={scanResult} onClose={() => setScan(false)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>}
    {help && <Sheet title="Como usar a etiqueta" onClose={() => setHelp(false)}>
      {[
        { icon: 'tag' as IconName, title: '1. Crie a etiqueta', text: 'Dê um nome ao objeto para gerar seu QR.' },
        { icon: 'maximize' as IconName, title: '2. Prenda e teste', text: 'Imprima o QR ou grave uma etiqueta NFC. Prenda ao objeto e teste com outro celular.' },
        { icon: 'message-circle' as IconName, title: '3. Acompanhe as conversas', text: 'Quem encontra abre o QR e avisa sem criar conta. Leia e responda em Conversas.' },
        { icon: 'check-circle' as IconName, title: '4. Confirme a devolução', text: 'Combinem um lugar público. Confirme o recebimento quando o objeto estiver com você.' },
      ].map(step => <View key={step.title} style={[s.row, { alignItems: 'flex-start', gap: 15 }]}><Icon name={step.icon} color={C.purple} /><View style={{ flex: 1, gap: 7 }}><Text style={s.h3}>{step.title}</Text><Text style={s.body}>{step.text}</Text></View></View>)}
      <Text style={s.small}>A etiqueta não tem GPS nem rastreia localização. Alguém precisa encontrar e abrir o QR para avisar.</Text>
      <Button onPress={() => setHelp(false)}>Entendi</Button>
    </Sheet>}
    {recovery && <Sheet title="Guarde seu código" subtitle="Ele permite recuperar sua conta se você esquecer a senha." dismissible={false} onClose={() => {}}
      footer={<Button icon="check" onPress={() => setRecovery(undefined)}>Já guardei meu código</Button>}>
      <Text style={s.body}>Salve em um gerenciador de senhas ou anote em um lugar seguro.</Text>
      <Text selectable accessibilityLabel={`Código de recuperação: ${recovery}`} style={{ fontSize: 17, color: C.ink, backgroundColor: C.surface, padding: 16, borderRadius: 12, lineHeight: 29 }}>{recovery}</Text>
      <Button variant="secondary" icon={Platform.OS === 'web' ? 'copy' : 'share-2'} onPress={() => void saveRecovery()}>{Platform.OS === 'web' ? 'Copiar código' : 'Guardar código'}</Button>
      {!!copyNotice && <Text accessibilityRole="alert" style={s.small}>{copyNotice}</Text>}
    </Sheet>}
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Content /></SafeAreaProvider>; }
