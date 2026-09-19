import { useMutation, useQuery } from '@tanstack/react-query';
import { apiQueryOptions } from './query';
import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { Provider, User } from './api';
import { authenticate, AuthAvailability } from './platform/auth';
import ProviderButton from './ProviderButton';
import AccountActionSheet from './AccountActionSheet';
import WelcomeIllustration from './WelcomeIllustration';
import { translateNotice } from './i18n';
import { Brand, Button, useUI } from './ui';

export default function Auth({ onAuth, onScan }: { onAuth: (token: string, user: User, recoveryCode?: string) => Promise<void>; onScan: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [methods, setMethods] = useState(false);
  const availabilityQuery = useQuery(apiQueryOptions<AuthAvailability>('/auth/providers'));
  const availability = availabilityQuery.data;
  const [busy, setBusy] = useState<Provider | null>(null);
  const active = useRef(false);
  useEffect(() => { if (availabilityQuery.error) ToastAndroid.show(t("Não foi possível verificar os acessos disponíveis. Tente novamente."), ToastAndroid.LONG); }, [availabilityQuery.error]);
  const loginMutation = useMutation({ mutationFn: (provider: Provider) => authenticate(provider, 'login', undefined, locale.slice(0, 2)) });
  async function login(provider: Provider) {
    if (active.current) return;
    active.current = true; setBusy(provider);
    try {
      const result = await loginMutation.mutateAsync(provider);
      if (result?.token && result.user) await onAuth(result.token, result.user);
    } catch (cause) { ToastAndroid.show(translateNotice(t, cause instanceof Error ? cause.message : 'Não foi possível entrar. Tente novamente.'), ToastAndroid.LONG); }
    finally { active.current = false; setBusy(null); }
  }
  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.content} accessibilityElementsHidden={methods} importantForAccessibility={methods ? 'no-hide-descendants' : 'auto'}>
        <View style={styles.brand}><Brand /></View>
        <View style={styles.art}><WelcomeIllustration paused={methods} /></View>
        <View style={styles.hero}>
          <Text accessibilityRole="header" style={styles.title}>{t("O que é seu,")}{'\n'}{t("sempre perto")}<Text style={{ color: C.accent }}>.</Text></Text>
          <Text style={[s.body, styles.center]}>{t("Uma etiqueta. Um caminho de volta.")}</Text>
        </View>
        <View style={styles.actions}>
          <Button onPress={() => setMethods(true)}>{t("Começar")}</Button>
          <Button variant="ghost" icon="maximize" onPress={onScan}>{t("Encontrei um objeto")}</Button>
        </View>
      </View>
    </ScrollView>
    {methods && <AccountActionSheet title={t("Entrar no SeekerTag")} busy={!!busy} onClose={() => setMethods(false)}>
      <View style={styles.methods}>
        <ProviderButton align="left" provider="solana" label={t("Continuar com Seeker / Solana")} busy={busy === 'solana'} disabled={!!busy && busy !== 'solana'} onPress={() => void login('solana')} />
        <View style={styles.divider}><View style={styles.line} /><Text style={s.small}>{t("ou continue com")}</Text><View style={styles.line} /></View>
        <ProviderButton align="left" provider="google" label={t("Continuar com Google")} busy={busy === 'google'} disabled={!availability || (!!busy && busy !== 'google')} unavailable={availability?.google === false} onPress={() => void login('google')} />
        <ProviderButton align="left" provider="apple" label={t("Continuar com Apple")} busy={busy === 'apple'} disabled={!availability || (!!busy && busy !== 'apple')} unavailable={availability?.apple === false} onPress={() => void login('apple')} />
      </View>
    </AccountActionSheet>}
  </View>;
}
const makeStyles = (C: Colors) => StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: C.bg, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, alignItems: 'center' },
  content: { width: '100%', maxWidth: 440, flexGrow: 1 },
  brand: { alignItems: 'center' },
  art: { flexGrow: 1, justifyContent: 'center', paddingVertical: 12 },
  hero: { gap: 14, paddingBottom: 32 },
  title: { color: C.ink, fontSize: 38, lineHeight: 44, letterSpacing: -0.8, fontWeight: '700', textAlign: 'center' },
  actions: { gap: 8 },
  methods: { gap: 14 }, divider: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 9 }, line: { flex: 1, height: 1, backgroundColor: C.line },
  center: { textAlign: 'center' },
});
