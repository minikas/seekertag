import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import * as Clipboard from 'expo-clipboard';
import { User } from './api';
import { WalletPanel } from './platform/WalletPanel';
import { providerNames } from './platform/auth';
import { Button, C, Icon, IconName, Notice, Sheet, s } from './ui';

type Props = { token: string; user: User; onUserUpdated: (user: User) => void; onClose: () => void; onHelp: () => void; onLogout: () => Promise<void> };
export default function Account({ token, user, onUserUpdated, onClose, onHelp, onLogout }: Props) {
  const [page, setPage] = useState<'main' | 'access' | 'receive'>('main');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copyReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCopied(false);
    return () => { if (copyReset.current) clearTimeout(copyReset.current); };
  }, [page, user.id]);
  const shortAddress = user.walletAddress ? `${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}` : null;
  const walletName = shortAddress && user.name === `Solana ${shortAddress}`;
  const back = () => { setError(''); if (page === 'main') onClose(); else setPage('main'); };
  async function copyId() {
    try {
      await Clipboard.setStringAsync(user.id); setCopied(true); setError('');
      if (copyReset.current) clearTimeout(copyReset.current);
      copyReset.current = setTimeout(() => setCopied(false), 2000);
    } catch { setError('Não foi possível copiar. Toque e segure o ID para selecioná-lo.'); }
  }
  async function logout() { setBusy(true); setError(''); try { await onLogout(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Sheet title={page === 'access' ? 'Formas de entrar' : page === 'receive' ? 'Receber etiquetas' : 'Minha conta'} onClose={back} footer={page === 'main' ? <Button variant="danger" icon="log-out" busy={busy} onPress={() => void logout()}>Sair da conta</Button> : undefined}>
    {page === 'main' ? <>
      <View style={styles.identity}><View style={[s.circle, { width: 56, height: 56, borderRadius: 20 }]}><Icon name="user" size={26} /></View><View style={{ flex: 1, gap: 6 }}><Text style={s.label}>{walletName ? 'Sua carteira' : 'Seu perfil'}</Text><Text style={s.h2}>{walletName ? shortAddress : user.name}</Text>{!!user.email && <Text style={s.small}>{user.email}</Text>}</View></View>
      <View>
        <AccountRow icon="credit-card" title="Formas de entrar" subtitle={user.providers.map(p => providerNames[p]).join(', ') || 'E-mail e senha'} onPress={() => setPage('access')} />
        <AccountRow icon="download" title="Receber etiquetas" subtitle="Compartilhe seu ID da conta" onPress={() => setPage('receive')} />
        <AccountRow icon="help-circle" title="Como funciona" onPress={() => { onClose(); onHelp(); }} />
      </View>
    </> : page === 'access' ? <WalletPanel token={token} user={user} onUserUpdated={onUserUpdated} /> : <>
      <View style={[s.empty, { gap: 24 }]}><View style={s.circle}><Icon name="tag" size={28} /></View><Text style={[s.body, { textAlign: 'center' }]}>Envie este ID para quem vai transferir uma etiqueta para você.</Text></View>
      <View style={[s.card, { gap: 12 }]}><Text style={s.label}>ID da conta</Text><Text selectable style={[s.small, { color: C.ink }]}>{user.id}</Text></View>
      <Button icon={copied ? 'check' : 'copy'} onPress={() => void copyId()}>{copied ? 'ID copiado' : 'Copiar ID da conta'}</Button>
    </>}
    {!!error && <Notice error text={error} />}
  </Sheet>;
}
function AccountRow({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}><View style={s.settingsIcon}><Icon name={icon} size={20} /></View><View style={{ flex: 1, gap: 6 }}><Text style={styles.rowTitle}>{title}</Text>{!!subtitle && <Text style={s.small}>{subtitle}</Text>}</View><Icon name="chevron-right" color={C.muted} size={18} /></Pressable>;
}
const styles = StyleSheet.create({
  identity: { flexDirection: 'row', gap: 18, alignItems: 'center', paddingVertical: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowTitle: { color: C.ink, fontSize: 18, lineHeight: 26 },
});
