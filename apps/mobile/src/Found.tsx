import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ActivityIndicator, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { api, Provider, Report, Tag, User } from './api';
import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import { categoryInk, tagCategoryLabel } from './category.model';
import Conversation from './Conversation';
import RewardSummary from './RewardSummary';
import { secureStorage } from './platform/storage';
import { Button, Field, Icon, IconName, Notice, useUI } from './ui';
import { finderFormSchema, type FinderFormValues } from './form.model';
import { authenticate, AuthAvailability } from './platform/auth';
import ProviderButton from './ProviderButton';
import AccountActionSheet from './AccountActionSheet';
import { translateNotice } from './i18n';

export default function Found({ code, chatId, token, goHome, goChat, onAuth }: { code?: string; chatId?: string; token: string | null; goHome: () => void; goChat: (id: string) => void; onAuth: (token: string, user: User) => Promise<void> }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [viewerIsOwner, setViewerIsOwner] = useState(false); const [account, setAccount] = useState(false); const [availability, setAvailability] = useState<AuthAvailability>(); const [provider, setProvider] = useState<Provider | null>(null);
  const [tag, setTag] = useState<Tag>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [chatToken, setChatToken] = useState<string | null>(null);
  const { control, handleSubmit, watch, formState: { errors } } = useForm<FinderFormValues>({ resolver: zodResolver(finderFormSchema), mode: 'onChange', defaultValues: { finderName: '', message: '' } });
  const message = watch('message');
  useEffect(() => {
    let live = true;
    setLoading(true); setError(''); setTag(undefined); setChatToken(null); setViewerIsOwner(false);
    async function load() {
      try {
        if (chatId) {
          const saved = await secureStorage.get(`finder-${chatId}`);
          if (saved) { if (live) setChatToken(saved); }
          else if (token) { await api<{ report: Report }>(`/finder/reports/${chatId}`, token); if (live) setChatToken(token); }
          else throw new Error('Entre na conta em que você salvou esta conversa ou abra-a no aparelho em que enviou o aviso.');
        } else if (code) {
          // Determine ownership before resuming any finder thread from this phone.
          const result = await api<{ tag: Tag; viewerIsOwner: boolean }>(`/public/tags/${encodeURIComponent(code)}`, token);
          if (!live) return;
          setTag(result.tag); setViewerIsOwner(result.viewerIsOwner);
          if (result.viewerIsOwner) return;
          if (token) {
            const savedAccountReport = await api<{ report: Report | null }>(`/finder/tags/${encodeURIComponent(code)}/report`, token);
            if (savedAccountReport.report) { if (live) goChat(savedAccountReport.report.id); return; }
          }
          const previous = await secureStorage.get(`tag-chat-${code}`);
          if (previous) {
            const saved = await secureStorage.get(`finder-${previous}`);
            if (saved) {
              const existing = await api<{ report: Report }>(`/finder/reports/${previous}`, saved);
              if (existing.report.status === 'open') { if (live) goChat(previous); return; }
              await secureStorage.remove(`tag-chat-${code}`);
            }
          }
        }
      } catch (e) { if (live) setError((e as Error).message); }
      finally { if (live) setLoading(false); }
    }
    void load();
    return () => { live = false; };
  }, [code, chatId, token]);
  useEffect(() => { if (!account) return; let live = true; api<AuthAvailability>('/auth/providers').then(value => { if (live) setAvailability(value); }).catch(() => { if (live) ToastAndroid.show(t('Não foi possível verificar os acessos disponíveis. Tente novamente.'), ToastAndroid.LONG); }); return () => { live = false; }; }, [account, t]);
  async function submit(values: FinderFormValues) { if (busy || loading || viewerIsOwner || !tag) return; setError(''); setBusy(true); try { const result = await api<{ report: Report; token: string }>(`/public/tags/${code}/reports`, token, { finderName: values.finderName || t('Uma pessoa que quer ajudar'), message: values.message }); await secureStorage.set(`finder-${result.report.id}`, result.token); await secureStorage.set(`tag-chat-${code}`, result.report.id); goChat(result.report.id); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function login(providerName: Provider) {
    if (provider) return;
    setProvider(providerName);
    try {
      const result = await authenticate(providerName, 'login', undefined, locale.slice(0, 2));
      if (!result?.token || !result.user) return;
      await onAuth(result.token, result.user);
      if (chatId && chatToken) await api(`/finder/reports/${chatId}/account`, result.token, { token: chatToken });
      setAccount(false);
      ToastAndroid.show(t(chatId ? 'Conversa salva na sua conta.' : 'Conta pronta. Esta conversa será salva nela.'), ToastAndroid.LONG);
    } catch (cause) { ToastAndroid.show(translateNotice(t, cause instanceof Error ? cause.message : 'Não foi possível entrar. Tente novamente.'), ToastAndroid.LONG); }
    finally { setProvider(null); }
  }
  const cat = { color: tag?.color || C.raised, icon: (tag?.categoryIcon || 'box') as IconName };
  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    <View style={s.screenHeader}>
      <Button variant="ghost" icon="arrow-left" onPress={goHome} label={t("Página inicial")} />
      <Text accessibilityRole="header" style={s.screenTitle}>{chatId ? t("Conversa") : t("Devolver objeto")}</Text>
      <View style={{ width: 48 }} />
    </View>
    <KeyboardAwareScrollView mode="layout" bottomOffset={24} disableScrollOnKeyboardHide keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={styles.content}>
      {loading && <View style={styles.loadingState} accessibilityLabel={t('Carregando etiqueta')}>
        <View style={styles.skeletonIdentity}>
          <View style={[styles.skeletonBlock, { height: 64, width: 64, borderRadius: 22 }]} />
          <View style={{ flex: 1, gap: 10 }}>
            <View style={[styles.skeletonLine, { width: '62%', height: 24 }]} />
            <View style={[styles.skeletonLine, { width: '38%', height: 16 }]} />
          </View>
        </View>
        <View style={styles.skeletonMessage}>
          <View style={[styles.skeletonLine, { width: '34%', height: 18 }]} />
          <View style={[styles.skeletonLine, { width: '92%', height: 18 }]} />
          <View style={[styles.skeletonLine, { width: '74%', height: 18 }]} />
          <View style={[styles.skeletonLine, { width: '58%', height: 18 }]} />
        </View>
        <View style={styles.skeletonReward}>
          <View style={[styles.skeletonBlock, { height: 56, width: 56, borderRadius: 20 }]} />
          <View style={{ flex: 1, gap: 10 }}>
            <View style={[styles.skeletonLine, { width: '48%', height: 18 }]} />
            <View style={[styles.skeletonLine, { width: '28%', height: 24 }]} />
          </View>
        </View>
      </View>}
      {!!error && <Notice error text={error} />}
      {chatId && chatToken ? <><Conversation id={chatId} token={chatToken} finder />{!token && <View style={s.card}><Text style={s.h3}>{t('Salve esta conversa')}</Text><Text style={s.body}>{t('Crie uma conta para continuar esta conversa em outro celular.')}</Text><Button variant="secondary" icon="user" onPress={() => setAccount(true)}>{t('Criar conta ou entrar')}</Button></View>}</> : tag ? <>
        <View style={styles.identity}>
          <View style={[styles.itemIcon, { backgroundColor: cat.color }]}><Icon name={cat.icon} color={categoryInk(cat.color)} size={28} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text accessibilityRole="header" style={s.h2}>{tag.name}</Text><Text style={s.body}>{tagCategoryLabel(tag, t)}</Text></View>
        </View>
        {tag.publicMessage ? <View style={styles.message}><Text style={s.label}>{t("Mensagem do dono")}</Text><Text style={[s.body, { color: C.ink }]}>{tag.publicMessage}</Text></View> : <Text style={s.body}>{t("Envie uma mensagem para combinar a devolução.")}</Text>}
        {(tag.rewardAmount > 0 || tag.reward) && <View style={s.card}><RewardSummary reward={tag.reward} amount={tag.rewardAmount} currency={tag.rewardCurrency} /></View>}
        {viewerIsOwner ? <View style={styles.ownerPreview}>
          <View style={[styles.ownerIcon, { backgroundColor: C.soft }]}><Icon name="eye" color={C.accent} size={26} /></View>
          <Text style={[s.h2, { textAlign: 'center' }]}>{t("Esta etiqueta é sua")}</Text>
          <Text style={[s.body, { textAlign: 'center', color: C.muted }]}>{t("Você está vendo como seu objeto aparece para quem o encontrar.")}</Text>
        </View> : <>
        <Controller control={control} name="finderName" render={({ field }) => <Field label={t("Seu nome (opcional)")} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.finderName?.message} placeholder={t("Seu primeiro nome ou apelido")} maxLength={60} editable={!busy} autoComplete="nickname" />} />
        <Controller control={control} name="message" render={({ field }) => <Field label={t("Mensagem para o dono")} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.message?.message} placeholder={t("Conte onde encontrou o objeto.")} multiline maxLength={2000} editable={!busy} />} />
        <Button onPress={() => void handleSubmit(submit)()} busy={busy} disabled={loading || !message.trim() || !!errors.message || !!errors.finderName} icon="send">{t("Avisar o dono")}</Button>
        {!token && <View style={s.card}><Text style={s.h3}>{t('Quer continuar em outro celular?')}</Text><Text style={s.body}>{t('Crie uma conta antes de avisar o dono para salvar a conversa.')}</Text><Button variant="secondary" icon="user" onPress={() => setAccount(true)}>{t('Criar conta ou entrar')}</Button></View>}
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={16} color={C.muted} /><Text style={[s.small, { flex: 1 }]}>{t("Converse pelo app sem compartilhar seus contatos.")}</Text></View>
        </>}
      </> : null}
    </KeyboardAwareScrollView>
    {account && <AccountActionSheet title={t('Salvar conversa na conta')} busy={!!provider} onClose={() => setAccount(false)}><View style={styles.methods}>
      <Text style={s.body}>{t('Use sua conta SeekerTag para retomar esta conversa em qualquer celular.')}</Text>
      <ProviderButton align="left" provider="solana" label={t('Continuar com Seeker / Solana')} busy={provider === 'solana'} disabled={!!provider && provider !== 'solana'} onPress={() => void login('solana')} />
      <View style={styles.divider}><View style={styles.line} /><Text style={s.small}>{t('ou continue com')}</Text><View style={styles.line} /></View>
      <ProviderButton align="left" provider="google" label={t('Continuar com Google')} busy={provider === 'google'} disabled={!availability || (!!provider && provider !== 'google')} unavailable={availability?.google === false} onPress={() => void login('google')} />
      <ProviderButton align="left" provider="apple" label={t('Continuar com Apple')} busy={provider === 'apple'} disabled={!availability || (!!provider && provider !== 'apple')} unavailable={availability?.apple === false} onPress={() => void login('apple')} />
    </View></AccountActionSheet>}
  </View>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 24, width: '100%', maxWidth: 600, alignSelf: 'center' },
  ownerPreview: { alignItems: 'center', gap: 16, padding: 24, borderRadius: 24, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  ownerIcon: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  loadingState: { gap: 18, paddingVertical: 18 },
  skeletonIdentity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  skeletonMessage: { minHeight: 148, padding: 18, borderRadius: 22, backgroundColor: C.surface, gap: 12 },
  skeletonReward: { minHeight: 100, padding: 20, borderRadius: 26, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', gap: 14 },
  skeletonBlock: { backgroundColor: C.surface },
  skeletonLine: { borderRadius: 8, backgroundColor: C.surface },
  skeletonCard: { width: '100%', borderRadius: 22, backgroundColor: C.surface },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  itemIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  message: { padding: 18, borderRadius: 22, backgroundColor: C.surface, gap: 8 },
  methods: { gap: 14 }, divider: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 9 }, line: { flex: 1, height: 1, backgroundColor: C.line },
});
