import { useThemedStyles } from '../PreferencesProvider';
import { Colors } from '../theme';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressable from '../HapticPressable';
import * as Clipboard from 'expo-clipboard';
import { api, Provider, User } from '../api';
import ProviderButton, { ProviderMark } from '../ProviderButton';
import { Icon, Notice, useUI } from '../ui';
import { authenticate, AuthAvailability, providerNames } from './auth';

export function WalletPanel({ token, user, onUserUpdated }: { token: string; user: User; onUserUpdated: (user: User) => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [availability, setAvailability] = useState<AuthAvailability>();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const active = useRef(false);
  const copyReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyReset.current) clearTimeout(copyReset.current); }, []);
  useEffect(() => { setCopied(false); }, [user.walletAddress]);
  useEffect(() => { let live = true; api<AuthAvailability>('/auth/providers').then(value => { if (live) setAvailability(value); }).catch(() => { if (live) setError(t("Não foi possível carregar as formas de acesso.")); }); return () => { live = false; }; }, []);
  async function link(provider: Provider) {
    if (active.current) return;
    active.current = true; setBusy(provider); setError('');
    try {
      const result = await authenticate(provider, 'link', token, locale.slice(0, 2));
      if (result?.user) onUserUpdated(result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível vincular este acesso.'); }
    finally { active.current = false; setBusy(null); }
  }
  async function copyAddress() {
    if (!user.walletAddress) return;
    try {
      await Clipboard.setStringAsync(user.walletAddress);
      setCopied(true); setError('');
      if (copyReset.current) clearTimeout(copyReset.current);
      copyReset.current = setTimeout(() => setCopied(false), 2500);
    } catch { setError('Não foi possível copiar o endereço. Tente novamente.'); }
  }
  return <View style={{ gap: 22 }}>
    <Text style={s.body}>{t("Escolha como acessar sua conta.")}</Text>
    {(['solana', 'google', 'apple'] as Provider[]).map(provider => user.providers.includes(provider) ? <View key={provider} style={styles.linkedCard}>
      <View style={styles.row}><View style={styles.icon}><ProviderMark provider={provider} color={C.ink} /></View><View style={{ flex: 1, gap: 4 }}><Text style={styles.title}>{providerNames[provider]}</Text><Text style={s.small}>{t("Vinculado à sua conta")}</Text></View><Icon name="check-circle" color={C.green} size={20} /></View>
      {provider === 'solana' && !!user.walletAddress && <>
        <View style={s.divider} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("Copiar endereço da carteira")} accessibilityHint={t("Copia o endereço público completo da sua carteira Solana.")} onPress={() => void copyAddress()} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
          <View style={styles.icon}><Icon name={copied ? 'check' : 'copy'} size={22} color={C.muted} /></View><View style={{ flex: 1, gap: 5 }}><Text style={styles.title} accessibilityLiveRegion="polite">{copied ? t("Endereço copiado") : t("Endereço público")}</Text><Text style={s.small}>{user.walletAddress.slice(0, 4)}…{user.walletAddress.slice(-4)}</Text></View>
        </Pressable>
      </>}
    </View> : <ProviderButton key={provider} provider={provider} align="left" label={t("Vincular {provider}", { provider: providerNames[provider] })} onPress={() => void link(provider)} busy={busy === provider} disabled={!!busy && busy !== provider || (provider !== 'solana' && !availability)} unavailable={provider !== 'solana' && availability?.[provider] === false} />)}
    {user.hasPassword && <View style={s.row}><Icon name="check-circle" color={C.accent} size={18} /><Text style={s.label}>{t("E-mail e senha")}</Text></View>}
    {!!error && <Notice error text={error} />}
    <Text style={s.small}>{t("A carteira pede apenas uma assinatura, sem taxas.")}</Text>
  </View>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  linkedCard: { paddingVertical: 12, gap: 20 },
  icon: { width: 28, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 48 },
  title: { color: C.ink, fontSize: 18, lineHeight: 25 },
});
