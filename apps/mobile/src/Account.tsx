import Screen from './Screen';
import PreferenceOptions from './PreferenceOptions';
import AccountActionSheet, { AccountActionSheetHandle } from './AccountActionSheet';
import ReceiveLabels from './ReceiveLabels';
import { usePreferences } from './PreferencesProvider';
import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import Categories from './Categories';
import { User } from './api';
import { WalletPanel } from './platform/WalletPanel';
import { Button, Icon, IconName, Notice, useUI } from './ui';
import { api } from './api';
import type { RewardConfig, RewardNetwork } from '@seekertag/shared/reward';

type Props = { token: string; user: User; onUserUpdated: (user: User) => void; onClose: () => void; onHelp: () => void; onLogout: () => Promise<void>; onCategoriesChanged: () => void };
export default function Account({ token, user, onUserUpdated, onClose, onHelp, onLogout, onCategoriesChanged }: Props) {
  const { C, s, t } = useUI();
  const { preferences } = usePreferences();
  const styles = useThemedStyles(makeStyles);
  const [page, setPage] = useState<'main' | 'access' | 'categories'>('main');
  const [sheet, setSheet] = useState<'language' | 'theme' | 'receive' | 'network' | null>(null);
  const [rewardConfig, setRewardConfig] = useState<RewardConfig | null>();
  const sheetRef = useRef<AccountActionSheetHandle>(null);
  const dismissSheet = () => sheetRef.current?.dismiss();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shortAddress = user.walletAddress ? `${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}` : null;
  const walletName = shortAddress && user.name === `Solana ${shortAddress}`;
  React.useEffect(() => {
    let active = true;
    void api<{ config: RewardConfig | null }>('/rewards/config', token).then(result => { if (active) setRewardConfig(result.config); }).catch(() => { if (active) setRewardConfig(null); });
    return () => { active = false; };
  }, [token]);
  const back = () => { if (sheet) { dismissSheet(); return; } setError(''); if (page === 'main') onClose(); else setPage('main'); };
  async function logout() { setBusy(true); setError(''); try { await onLogout(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (page === 'categories') return <Categories presentation="screen" token={token} onClose={() => setPage('main')} onChanged={onCategoriesChanged} />;
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!sheet}>
    <Screen contentKey={page} title={page === 'access' ? t("Formas de entrar") : t("Minha conta")} onClose={back} footer={page === 'main' ? <Button variant="danger" icon="log-out" busy={busy} onPress={() => void logout()}>{t("Sair da conta")}</Button> : undefined}>
    {page === 'main' ? <>
      <View style={styles.identity}><View style={styles.identityIcon}><Icon name={user.walletAddress ? "credit-card" : "user"} size={30} color={C.muted} /></View><View style={{ flex: 1, gap: 6 }}><Text style={s.label}>{walletName ? t("Sua carteira") : t("Seu perfil")}</Text><Text style={styles.identityName}>{walletName ? shortAddress : user.name}</Text>{!!user.email && <Text style={s.small}>{user.email}</Text>}</View></View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Preferências")}</Text>
        <AccountRow icon="sun" title={t("Aparência")} value={{ system: t("Automático"), light: t("Claro"), dark: t("Escuro") }[preferences.theme]} onPress={() => setSheet('theme')} />
        <AccountRow icon="globe" title={t("Idioma")} value={{ system: t("Automático"), pt: 'Português', en: 'English', es: 'Español' }[preferences.language]} onPress={() => setSheet('language')} />
        <AccountRow icon="server" title={t("Rede de recompensas")} value={rewardConfig ? rewardConfig.network : rewardConfig === null ? t("Desativada") : t("Carregando…")} onPress={() => setSheet('network')} />
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Conta e objetos")}</Text>
        <AccountRow icon="credit-card" title={t("Formas de entrar")} onPress={() => setPage('access')} />
        <AccountRow icon="download" title={t("Receber etiquetas")} onPress={() => setSheet('receive')} />
        <AccountRow icon="grid" title={t("Categorias")} onPress={() => setPage('categories')} />
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Ajuda")}</Text>
        <AccountRow icon="help-circle" title={t("Como funciona")} onPress={onHelp} />
      </View>
    </> : <WalletPanel token={token} user={user} onUserUpdated={onUserUpdated} />}
    {!!error && <Notice error text={error} />}
    </Screen>
    </View>
    {!!sheet && <AccountActionSheet ref={sheetRef} title={sheet === 'receive' ? t("Receber etiquetas") : sheet === 'language' ? t("Idioma") : sheet === 'network' ? t("Rede de recompensas") : t("Aparência")} onClose={() => setSheet(null)}>
      {sheet === 'receive' ? <ReceiveLabels accountId={user.id} /> : sheet === 'network' ? <RewardNetworkOptions network={rewardConfig?.network || null} onSelected={dismissSheet} /> : <PreferenceOptions section={sheet} onSelected={dismissSheet} />}
    </AccountActionSheet>}
  </View>;
}
function RewardNetworkOptions({ network, onSelected }: { network: RewardNetwork | null; onSelected: () => void }) {
  const { C, s, t } = useUI();
  const options: { value: RewardNetwork; title: string }[] = [
    { value: 'devnet', title: 'Devnet' }, { value: 'testnet', title: 'Testnet' }, { value: 'mainnet', title: 'Mainnet' },
  ];
  return <View>{options.map(option => {
    const selected = network === option.value;
    return <Pressable key={option.value} testID={`reward-network-${option.value}`} accessibilityRole="radio" accessibilityLabel={option.title} accessibilityState={{ checked: selected, disabled: !selected }} disabled={!selected} onPress={onSelected} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, opacity: selected ? 1 : 0.4 }}>
      <View style={{ width: 24, alignItems: 'center' }}>{selected && <Icon name="check" size={22} color={C.accent} />}</View>
      <View style={{ flex: 1, gap: 6 }}><Text style={{ color: C.ink, fontSize: 18, lineHeight: 26 }}>{option.title}</Text><Text style={s.small}>{selected ? t('Ativa neste servidor') : t('Indisponível neste servidor')}</Text></View>
    </Pressable>;
  })}</View>;
}
function AccountRow({ icon, title, value, onPress }: { icon: IconName; title: string; value?: string; onPress: () => void }) {
  const { C } = useUI();
  const styles = useThemedStyles(makeStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
    <View style={styles.rowIcon}><Icon name={icon} size={23} color={C.muted} /></View>
    <Text style={styles.rowTitle}>{title}</Text>
    {!!value && <Text style={styles.rowValue}>{value}</Text>}
    <Icon name="chevron-right" color={C.muted} size={20} />
  </Pressable>;
}
const makeStyles = (C: Colors) => StyleSheet.create({
  identity: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  identityIcon: { width: 32, alignItems: 'center' },
  identityName: { color: C.ink, fontSize: 24, lineHeight: 32, fontWeight: '600' },
  section: { gap: 2 },
  sectionTitle: { color: C.muted, fontSize: 16, lineHeight: 24, fontWeight: '500', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 14 },
  rowIcon: { width: 28, alignItems: 'center' },
  rowTitle: { flex: 1, color: C.ink, fontSize: 18, lineHeight: 26 },
  rowValue: { color: C.muted, fontSize: 15, lineHeight: 22, maxWidth: '42%', textAlign: 'right', flexShrink: 1 },
});
