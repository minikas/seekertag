import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Provider } from './api';
import { useUI } from './ui';

export function ProviderMark({ provider, color }: { provider: Provider; color?: string }) {
  const { C, s, t, locale } = useUI();
  color ??= C.onPrimary;
  if (provider === 'apple') return <Ionicons name="logo-apple" color={color} size={23} />;
  if (provider === 'google') return <Svg width={21} height={21} viewBox="0 0 24 24"><Path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" /><Path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.06.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.07v2.59A10 10 0 0 0 12 22Z" /><Path fill="#FBBC05" d="M6.42 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.35-2.59Z" /><Path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.35 2.59C7.2 7.72 9.4 5.96 12 5.96Z" /></Svg>;
  return <Svg width={26} height={23} viewBox="0 0 28 24"><Path fill={color} d="M5 2h23l-5 5H0zM0 10h23l5 5H5zM5 18h23l-5 5H0z" /></Svg>;
}

export default function ProviderButton({ provider, label, onPress, busy = false, disabled = false, unavailable = false, align = 'center' }: { provider: Provider; label: string; onPress: () => void; busy?: boolean; disabled?: boolean; unavailable?: boolean; align?: 'left' | 'center' }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const primary = provider === 'solana';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={unavailable ? t("Este login ainda não está disponível.") : undefined} accessibilityState={{ disabled: disabled || unavailable, busy }} disabled={disabled || unavailable || busy} onPress={onPress} style={({ pressed }) => [styles.button, primary && styles.primary, provider === 'google' && styles.google, { opacity: pressed || disabled ? 0.65 : 1 }]}>
    <View style={styles.mark}>{busy ? <ActivityIndicator color={primary ? C.onPrimary : provider === 'google' ? '#1F1F1F' : '#FFFFFF'} /> : <ProviderMark provider={provider} color={primary ? C.onPrimary : '#FFFFFF'} />}</View>
    <Text style={[styles.label, { textAlign: align, color: primary ? C.onPrimary : provider === 'google' ? '#1F1F1F' : '#FFFFFF' }]}>{label}</Text>
    {unavailable && <Text style={[styles.soon, { color: provider === 'google' ? '#5F6368' : '#AAAAAE' }]}>{t("Em breve")}</Text>}
  </Pressable>;
}
const makeStyles = (C: Colors) => StyleSheet.create({
  button: { minHeight: 60, paddingHorizontal: 18, paddingVertical: 16, borderRadius: 20, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#000000', borderColor: C.raised, borderWidth: 1 },
  primary: { backgroundColor: C.primary, borderColor: C.primary, minHeight: 64 }, google: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' }, mark: { width: 27, alignItems: 'center' }, label: { fontSize: 16, fontWeight: '500', flex: 1, textAlign: 'center' }, soon: { fontSize: 12 },
});
