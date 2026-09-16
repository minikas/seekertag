import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api, Report, Tag } from './api';
import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import { categoryInk, tagCategoryLabel } from './category.model';
import Conversation from './Conversation';
import { secureStorage } from './platform/storage';
import { Button, Field, Icon, IconName, Notice, useUI } from './ui';

export default function Found({ code, chatId, goHome, goChat }: { code?: string; chatId?: string; goHome: () => void; goChat: (id: string) => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [tag, setTag] = useState<Tag>(); const [finderName, setFinderName] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [chatToken, setChatToken] = useState<string | null>(null);
  useEffect(() => { let live = true; setLoading(true); setError(''); setTag(undefined); setChatToken(null); async function load() { try { if (chatId) { const token = await secureStorage.get(`finder-${chatId}`); if (!token) throw new Error('Esta conversa está disponível no aplicativo em que você avisou o dono. Se apagou os dados do app ou está em outro aparelho, escaneie a etiqueta e envie um novo aviso.'); if (live) setChatToken(token); } else if (code) { const previous = await secureStorage.get(`tag-chat-${code}`); if (previous) { const saved = await secureStorage.get(`finder-${previous}`); if (saved) { const existing = await api<{ report: Report }>(`/finder/reports/${previous}`, saved); if (existing.report.status === 'open') { if (live) goChat(previous); return; } await secureStorage.remove(`tag-chat-${code}`); } } const result = await api<{ tag: Tag }>(`/public/tags/${encodeURIComponent(code)}`); if(live) setTag(result.tag); } } catch(e) { if(live) setError((e as Error).message); } finally { if(live) setLoading(false); } } load(); return () => { live = false; }; }, [code, chatId]);
  async function submit() { if (busy) return; if (!message.trim()) { setError('Escreva uma mensagem para avisar onde encontrou o objeto.'); return; } setError(''); setBusy(true); try { const result = await api<{ report: Report; token: string }>(`/public/tags/${code}/reports`, null, { finderName: finderName.trim() || t('Uma pessoa que quer ajudar'), message: message.trim() }); await secureStorage.set(`finder-${result.report.id}`, result.token); await secureStorage.set(`tag-chat-${code}`, result.report.id); goChat(result.report.id); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  const cat = { color: tag?.color || C.raised, icon: (tag?.categoryIcon || 'box') as IconName };
  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    <View style={s.screenHeader}>
      <Button variant="ghost" icon="arrow-left" onPress={goHome} label={t("Página inicial")} />
      <Text accessibilityRole="header" style={s.screenTitle}>{chatId ? t("Conversa") : t("Devolver objeto")}</Text>
      <View style={{ width: 48 }} />
    </View>
    <KeyboardAwareScrollView mode="layout" bottomOffset={24} disableScrollOnKeyboardHide keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={styles.content}>
      {loading && <ActivityIndicator color={C.ink} style={{ marginVertical: 40 }} />}
      {!!error && <Notice error text={error} />}
      {chatId && chatToken ? <Conversation id={chatId} token={chatToken} finder /> : tag ? <>
        <View style={styles.identity}>
          <View style={[styles.itemIcon, { backgroundColor: cat.color }]}><Icon name={cat.icon} color={categoryInk(cat.color)} size={28} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text accessibilityRole="header" style={s.h2}>{tag.name}</Text><Text style={s.body}>{tagCategoryLabel(tag, t)}</Text></View>
        </View>
        {tag.publicMessage ? <View style={styles.message}><Text style={s.label}>{t("Mensagem do dono")}</Text><Text style={[s.body, { color: C.ink }]}>{tag.publicMessage}</Text></View> : <Text style={s.body}>{t("Envie uma mensagem para combinar a devolução.")}</Text>}
        {tag.rewardAmount > 0 && <View style={s.row}>
          <View style={s.settingsIcon}><Icon name="gift" size={20} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{tag.rewardCurrency === 'BRL' ? 'R$' : tag.rewardCurrency} {tag.rewardAmount.toLocaleString(locale)} {t("de agradecimento")}</Text><Text style={s.small}>{t("Promessa do dono. Pagamento combinado na conversa.")}</Text></View>
        </View>}
        <Field label={t("Seu nome (opcional)")} value={finderName} onChangeText={setFinderName} placeholder={t("Seu primeiro nome ou apelido")} maxLength={60} editable={!busy} autoComplete="nickname" />
        <Field label={t("Mensagem para o dono")} value={message} onChangeText={setMessage} placeholder={t("Conte onde encontrou o objeto.")} multiline maxLength={2000} editable={!busy} />
        <Button onPress={submit} busy={busy} disabled={!message.trim()} icon="send">{t("Avisar o dono")}</Button>
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={16} color={C.muted} /><Text style={[s.small, { flex: 1 }]}>{t("Converse pelo app sem compartilhar seus contatos.")}</Text></View>
      </> : null}
    </KeyboardAwareScrollView>
  </View>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 24, width: '100%', maxWidth: 600, alignSelf: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  itemIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  message: { padding: 18, borderRadius: 22, backgroundColor: C.surface, gap: 8 },
});
