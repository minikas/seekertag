import Screen from './Screen';
import PreferenceOptions from './PreferenceOptions';
import AccountActionSheet, { AccountActionSheetHandle } from './AccountActionSheet';
import { usePreferences } from './PreferencesProvider';
import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import * as Clipboard from 'expo-clipboard';
import Categories from './Categories';
import { User } from './api';
import { WalletPanel } from './platform/WalletPanel';
import { providerNames } from './platform/auth';
import { Button, Icon, IconName, Notice, useUI } from './ui';

type Props = { token: string; user: User; onUserUpdated: (user: User) => void; onClose: () => void; onHelp: () => void; onLogout: () => Promise<void>; onCategoriesChanged: () => void };
export default function Account({ token, user, onUserUpdated, onClose, onHelp, onLogout, onCategoriesChanged }: Props) {
  const { C, s, t, locale } = useUI();
  const { preferences } = usePreferences();
  const styles = useThemedStyles(makeStyles);
  const [page, setPage] = useState<'main' | 'access' | 'receive' | 'categories'>('main');
  const [sheet, setSheet] = useState<'language' | 'theme' | null>(null);
  const sheetRef = useRef<AccountActionSheetHandle>(null);
  const dismissSheet = () => sheetRef.current?.dismiss();
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
  const back = () => { if (sheet) { dismissSheet(); return; } setError(''); if (page === 'main') onClose(); else setPage('main'); };
  async function copyId() {
    try {
      await Clipboard.setStringAsync(user.id); setCopied(true); setError('');
      if (copyReset.current) clearTimeout(copyReset.current);
      copyReset.current = setTimeout(() => setCopied(false), 2000);
    } catch { setError('Não foi possível copiar. Toque e segure o ID para selecioná-lo.'); }
  }
  async function logout() { setBusy(true); setError(''); try { await onLogout(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (page === 'categories') return <Categories presentation="screen" token={token} onClose={() => setPage('main')} onChanged={onCategoriesChanged} />;
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!sheet}>
    <Screen contentKey={page} title={page === 'access' ? t("Formas de entrar") : page === 'receive' ? t("Receber etiquetas") : t("Minha conta")} onClose={back} footer={page === 'main' ? <Button variant="danger" icon="log-out" busy={busy} onPress={() => void logout()}>{t("Sair da conta")}</Button> : undefined}>
    {page === 'main' ? <>
      <View style={styles.identity}><View style={[s.circle, { width: 56, height: 56, borderRadius: 20 }]}><Icon name="user" size={26} /></View><View style={{ flex: 1, gap: 6 }}><Text style={s.label}>{walletName ? t("Sua carteira") : t("Seu perfil")}</Text><Text style={s.h2}>{walletName ? shortAddress : user.name}</Text>{!!user.email && <Text style={s.small}>{user.email}</Text>}</View></View>
      <View>
        <AccountRow icon="credit-card" title={t("Formas de entrar")} subtitle={user.providers.map(p => providerNames[p]).join(', ') || t("E-mail e senha")} onPress={() => setPage('access')} />
        <AccountRow icon="download" title={t("Receber etiquetas")} subtitle={t("Compartilhe seu ID da conta")} onPress={() => setPage('receive')} />
        <AccountRow icon="grid" title={t("Categorias")} onPress={() => setPage('categories')} />
        <AccountRow icon="sliders" title={t("Aparência")} subtitle={{ system: t("Igual ao dispositivo"), light: t("Claro"), dark: t("Escuro") }[preferences.theme]} onPress={() => setSheet('theme')} />
        <AccountRow icon="globe" title={t("Idioma")} subtitle={{ system: t("Igual ao dispositivo"), pt: 'Português', en: 'English', es: 'Español' }[preferences.language]} onPress={() => setSheet('language')} />
        <AccountRow icon="help-circle" title={t("Como funciona")} onPress={onHelp} />
      </View>
    </> : page === 'access' ? <WalletPanel token={token} user={user} onUserUpdated={onUserUpdated} /> : <>
      <View style={[s.empty, { gap: 24 }]}><View style={s.circle}><Icon name="tag" size={28} /></View><Text style={[s.body, { textAlign: 'center' }]}>{t("Envie este ID para quem vai transferir uma etiqueta para você.")}</Text></View>
      <View style={[s.card, { gap: 12 }]}><Text style={s.label}>{t("ID da conta")}</Text><Text selectable style={[s.small, { color: C.ink }]}>{user.id}</Text></View>
      <Button icon={copied ? 'check' : 'copy'} onPress={() => void copyId()}>{copied ? t("ID copiado") : t("Copiar ID da conta")}</Button>
    </>}
    {!!error && <Notice error text={error} />}
    </Screen>
    </View>
    {!!sheet && <AccountActionSheet ref={sheetRef} title={sheet === 'language' ? t("Idioma") : t("Aparência")} onClose={() => setSheet(null)}>
      <PreferenceOptions section={sheet} onSelected={dismissSheet} />
    </AccountActionSheet>}
  </View>;
}
function AccountRow({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle?: string; onPress: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={t(title)} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}><View style={s.settingsIcon}><Icon name={icon} size={20} /></View><View style={{ flex: 1, gap: 6 }}><Text style={styles.rowTitle}>{t(title)}</Text>{!!subtitle && <Text style={s.small}>{t(subtitle)}</Text>}</View><Icon name="chevron-right" color={C.muted} size={18} /></Pressable>;
}
const makeStyles = (C: Colors) => StyleSheet.create({
  identity: { flexDirection: 'row', gap: 18, alignItems: 'center', paddingVertical: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowTitle: { color: C.ink, fontSize: 18, lineHeight: 26 },
});
