import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { api, Provider, User } from './api';
import { authenticate, AuthAvailability } from './platform/auth';
import EmailAuth from './EmailAuth';
import ProviderButton from './ProviderButton';
import { Brand, Button, C, Icon, Notice, s } from './ui';

export default function Auth({ onAuth, onScan }: { onAuth: (token: string, user: User, recoveryCode?: string) => Promise<void>; onScan: () => void }) {
  const [email, setEmail] = useState(false);
  const [availability, setAvailability] = useState<AuthAvailability>();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  const active = useRef(false);
  useEffect(() => { let live = true; api<AuthAvailability>('/auth/providers').then(value => { if (live) setAvailability(value); }).catch(() => { if (live) setError('Não foi possível verificar os acessos disponíveis. Tente novamente.'); }); return () => { live = false; }; }, []);
  async function login(provider: Provider) {
    if (active.current) return;
    active.current = true; setBusy(provider); setError('');
    try {
      const result = await authenticate(provider);
      if (result?.token && result.user) await onAuth(result.token, result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível entrar. Tente novamente.'); }
    finally { active.current = false; setBusy(null); }
  }
  if (email) return <View style={{ flex: 1 }}><Button variant="ghost" icon="arrow-left" onPress={() => setEmail(false)} style={{ alignSelf: 'flex-start', margin: 12 }}>Todas as formas de entrar</Button><EmailAuth onAuth={onAuth} onScan={onScan} /></View>;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.content}>
      <Brand />
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={styles.title}>O que é seu,{ '\n' }sempre perto<Text style={{ color: C.accent }}>.</Text></Text>
        <Text style={[s.body, { maxWidth: 330 }]}>Entre para cuidar dos seus objetos e facilitar o próximo reencontro.</Text>
      </View>
      <View style={styles.methods}>
        <ProviderButton provider="solana" label="Continuar com Seeker / Solana" busy={busy === 'solana'} disabled={!!busy && busy !== 'solana'} onPress={() => void login('solana')} />
        <View style={[s.row, { justifyContent: 'center' }]}><Icon name="shield" size={13} color={C.muted} /><Text style={s.small}>Uma assinatura. Sem senha e sem taxas.</Text></View>
        <View style={styles.divider}><View style={styles.line} /><Text style={s.small}>ou continue com</Text><View style={styles.line} /></View>
        <ProviderButton provider="google" label="Continuar com Google" busy={busy === 'google'} disabled={!availability || (!!busy && busy !== 'google')} unavailable={availability?.google === false} onPress={() => void login('google')} />
        <ProviderButton provider="apple" label="Continuar com Apple" busy={busy === 'apple'} disabled={!availability || (!!busy && busy !== 'apple')} unavailable={availability?.apple === false} onPress={() => void login('apple')} />
      </View>
      {!!error && <Notice error text={error} />}
      <Text style={[s.small, styles.center]}>Sua conta é criada no primeiro acesso.{ '\n' }Depois, é só usar a mesma forma de entrar.</Text>
      <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => setEmail(true)} style={styles.email}><Text style={styles.emailLabel}>Entrar com e-mail</Text><Icon name="arrow-up-right" size={14} color={C.muted} /></Pressable>
      <View style={styles.finder}>
        <Button variant="secondary" icon="maximize" onPress={onScan} disabled={!!busy}>Encontrei um objeto</Button>
        <Text style={[s.small, styles.center]}>Abra a etiqueta e avise o dono.{ '\n' }Você não precisa de uma conta.</Text>
      </View>
    </View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28, alignItems: 'center' },
  content: { width: '100%', maxWidth: 440, flexGrow: 1, gap: 24 }, hero: { gap: 18, paddingTop: 24, paddingBottom: 12 },
  title: { color: C.ink, fontSize: 40, lineHeight: 47, letterSpacing: -0.8, fontWeight: '700' }, methods: { gap: 14 }, divider: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 9 }, line: { flex: 1, height: 1, backgroundColor: C.line },
  center: { textAlign: 'center' }, email: { minHeight: 48, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center' }, emailLabel: { color: C.ink, fontSize: 16 }, finder: { gap: 14, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 24, marginTop: 'auto' },
});
