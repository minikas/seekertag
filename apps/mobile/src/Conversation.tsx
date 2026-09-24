import React, { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppState, Keyboard, RefreshControl, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiQueryKey, apiQueryOptions } from './query';
import { api, Message, Report, type Tag } from './api';
import { Button, Icon, Notice, Pill, useUI, type IconName } from './ui';
import { messageFormSchema, type MessageFormValues } from './form.model';
import { useConversationDrafts } from './Navigation';
import AccountActionSheet from './AccountActionSheet';
import ConversationReward, { type ConversationRewardData } from './ConversationReward';
import ReceivingWalletSheet from './ReceivingWalletSheet';
import RewardReleaseSheet from './RewardReleaseSheet';
import Pressable from './HapticPressable';
import { categoryInk, tagCategoryLabel } from './category.model';
import { useNotifications } from './NotificationsProvider';

type FinderItem = Pick<Tag, 'code' | 'name' | 'category' | 'categoryIcon' | 'color' | 'publicMessage' | 'status' | 'rewardAmount' | 'rewardCurrency'> & Partial<Pick<Tag, 'categoryDefaultKey'>>;
type ConversationData = { report: Report; messages: Message[]; tag?: FinderItem };

export default function Conversation({ id, token, finder = false, presentation = 'page', covered = false, historyFooter, onViewItem }: { id: string; token: string; finder?: boolean; presentation?: 'page' | 'sheet'; covered?: boolean; historyFooter?: React.ReactNode; onViewItem?: (report: Report, rewardOnly?: boolean) => void }) {
  const { C, s, t, locale } = useUI();
  const drafts = useConversationDrafts();
  const draftKey = `${finder ? 'finder' : 'owner'}:${id}`;
  const nearEnd = useRef(true);
  const { markRead, setActiveReport } = useNotifications();
  const readThrough = useRef(0);
  useEffect(() => { if (!covered) setActiveReport(id); readThrough.current = 0; return () => setActiveReport(undefined); }, [id, covered, setActiveReport]);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [sendError, setSendError] = useState('');
  const sending = useRef(false);
  const [details, setDetails] = useState(false);
  const [receivingWallet, setReceivingWallet] = useState(false);
  const [finishReturn, setFinishReturn] = useState(false);
  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<MessageFormValues>({ resolver: zodResolver(messageFormSchema), mode: 'onChange', defaultValues: { body: drafts?.get(draftKey) || '' } });
  const body = watch('body');
  const scroll = useRef<ScrollView>(null); const generation = useRef(0);
  const path = finder ? `/finder/reports/${id}` : `/reports/${id}`;
  const conversation = useQuery({ ...apiQueryOptions<ConversationData>(path, token), enabled: !covered, refetchInterval: 4000 });
  const report = conversation.data?.report;
  const messages = conversation.data?.messages || [];
  const item = conversation.data?.tag;
  const hasFinderMessage = messages.some(message => message.role === 'finder');
  const rewardQuery = useQuery({ ...apiQueryOptions<ConversationRewardData>(`${path}/reward`, token),
    enabled: !!report && (!finder || hasFinderMessage) && !covered && !details,
    refetchInterval: 6000,
  });
  async function refreshConversation() {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.all([conversation.refetch(), rewardQuery.refetch()]); }
    finally { setRefreshing(false); }
  }
  const recipient = rewardQuery.data?.recipient;
  const canEditReceivingWallet = finder && hasFinderMessage && report?.status === 'open'
    && !!rewardQuery.data && !rewardQuery.isError
    && !(rewardQuery.data.reward?.operation?.kind === 'release') && rewardQuery.data.reward?.status !== 'released';
  const showReceivingWallet = finder && hasFinderMessage && (!!recipient || canEditReceivingWallet);
  const reward = rewardQuery.data?.reward;
  const showFinishReturn = !finder && report?.status === 'open' && !!recipient
    && (!reward || ['reserved', 'expired', 'refunded'].includes(reward.status))
    && (!reward?.operation || reward.operation.kind === 'release');
  const markResolved = () => queryClient.setQueryData<ConversationData>(apiQueryKey(token, path), previous => previous ? { ...previous, report: { ...previous.report, status: 'resolved' } } : previous);
  async function copyReceivingAddress() {
    if (!recipient) return;
    try {
      await Clipboard.setStringAsync(recipient);
      ToastAndroid.show(t('Endereço copiado.'), ToastAndroid.SHORT);
    } catch { ToastAndroid.show(t('Não foi possível copiar o endereço. Tente novamente.'), ToastAndroid.SHORT); }
  }
  const sendMutation = useMutation({
    mutationFn: (values: { path: string; token: string; body: string }) => api<{ message: Message }>(`${values.path}/messages`, values.token, { body: values.body }),
  });
  const busy = sendMutation.isPending;
  const error = sendError || conversation.error?.message || rewardQuery.error?.message || '';
  useEffect(() => {
    reset({ body: drafts?.get(draftKey) || '' }); nearEnd.current = true; setSendError('');
    generation.current++; sending.current = false;
    return () => { generation.current++; };
  }, [path, token, reset]);
  useEffect(() => {
    const last = messages.filter(message => message.role !== (finder ? 'finder' : 'owner')).at(-1)?.id;
    if (last && last > readThrough.current && !covered && AppState.currentState === 'active') {
      readThrough.current = last;
      void markRead(last, id).then(saved => { if (!saved && readThrough.current === last) readThrough.current = 0; });
    }
  }, [messages, finder, id, markRead, covered]);
  async function send(values: MessageFormValues) {
    if (sending.current || busy) return;
    sending.current = true; setSendError('');
    const current = generation.current;
    try {
      const { message } = await sendMutation.mutateAsync({ path, token, body: values.body });
      queryClient.setQueryData<ConversationData>(apiQueryKey(token, path), previous => previous ? {
        ...previous, messages: previous.messages.some(item => item.id === message.id) ? previous.messages : [...previous.messages, message],
      } : previous);
      if (current === generation.current) { drafts?.set(draftKey, ''); nearEnd.current = true; reset({ body: '' }); }
    } catch (cause) { if (current === generation.current) setSendError((cause as Error).message); }
    finally { if (current === generation.current) sending.current = false; }
  }
  const sheet = presentation === 'sheet';
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  // This page already fills the safe-area viewport. Size the conversation from
  // the keyboard inset directly: nested page headers need no frame measurement.
  const keyboardInset = useAnimatedStyle(() => ({
    paddingBottom: !sheet && !covered && !details && !receivingWallet && !finishReturn ? Math.max(0, -keyboard.height.value - insets.bottom) : 0,
  }), [sheet, covered, details, receivingWallet, finishReturn, insets.bottom]);
  const ComposerInput = sheet ? BottomSheetTextInput : TextInput;
  return <Animated.View testID="conversation-keyboard-layout" style={[{ flex: 1 }, keyboardInset]}>
    <View style={{ flex: 1, gap: 14, minHeight: 0, ...(sheet ? {} : { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }) }}>
    <View style={{ gap: 5 }}>
      <View style={s.between}><Text style={[s.h3, { flex: 1 }]}>{report?.tagName || t("Conversa privada")}</Text>
        {(finder || onViewItem) && report && <Button variant="ghost" icon="tag" label={t('Ver objeto')} onPress={() => { Keyboard.dismiss(); if (finder) setDetails(true); else onViewItem?.(report); }} />}
      </View>
      <View style={s.row}>
        <Text style={s.small}>{finder ? t("Você está falando com o dono.") : t("Com {name}", { name: report?.finderName || t("quem encontrou") })}</Text>
        <View style={[s.row, { gap: 5 }]}><Icon name="shield" size={14} color={C.accent} /><Text style={{ color: C.accent, fontSize: 12, fontWeight: '600' }}>{t("Contatos protegidos")}</Text></View>
      </View>
    </View>
    {!!error && <Notice error text={error} />}
    {!report && !error ? <View accessibilityLabel={t("Carregando conversa")} style={{ gap: 14, paddingVertical: 10 }}>
      <View style={{ width: '78%', height: 54, borderRadius: 16, backgroundColor: C.surface }} />
      <View style={{ width: '58%', height: 42, borderRadius: 16, backgroundColor: C.surface, alignSelf: 'flex-end' }} />
      <View style={{ width: '70%', height: 58, borderRadius: 16, backgroundColor: C.surface }} />
    </View> : null}
    <ScrollView ref={scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshConversation()} tintColor={C.accent} colors={[C.accent]} />} alwaysBounceVertical testID="conversation-messages" style={[sheet ? { maxHeight: 300, minHeight: 180 } : { flex: 1, minHeight: 0 }, { display: report ? 'flex' : 'none' }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingVertical: 6, gap: 14 }} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; nearEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }} scrollEventThrottle={64} onLayout={() => { if (nearEnd.current && !covered) scroll.current?.scrollToEnd({ animated: false }); }} onContentSizeChange={() => { if (nearEnd.current && !covered) scroll.current?.scrollToEnd({ animated: false }); }}>
      {messages.map(message => { if (message.kind === 'wallet_confirmed') return <View key={message.id} style={{ alignSelf: 'center' }}><Notice tone="success" text={t('Carteira de recebimento confirmada.')} /></View>; const own = message.role === (finder ? 'finder' : 'owner'); return <View key={message.id} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 5 }}><View style={{ backgroundColor: own ? C.primary : C.surface, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, borderBottomRightRadius: own ? 4 : 16, borderBottomLeftRadius: own ? 16 : 4 }}><Text style={{ color: own ? C.onPrimary : C.ink, fontSize: 17, lineHeight: 25 }}>{message.body}</Text></View><Text style={[s.small, { fontSize: 12, alignSelf: own ? 'flex-end' : 'flex-start' }]}>{own ? t("Você") : message.role === 'owner' ? t("Dono") : report?.finderName || t("Quem encontrou")} · {new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</Text></View>; })}
      {showReceivingWallet && <View style={{ gap: 5, marginTop: 14, paddingTop: 30, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }}>
        <Pressable testID="conversation-receiving-wallet" accessibilityRole={canEditReceivingWallet ? 'button' : undefined}
          accessibilityLabel={recipient ? t('Sua carteira de recebimento') : t('Informar carteira de recebimento')} disabled={!canEditReceivingWallet}
          onPress={() => { Keyboard.dismiss(); setReceivingWallet(true); }}
          style={({ pressed }) => [s.row, { gap: 12, minHeight: 44, opacity: pressed ? 0.65 : 1 }]}>
          <Text style={[s.h3, { flex: 1 }]}>{recipient ? t('Sua carteira de recebimento') : t('Informar carteira de recebimento')}</Text>
          {canEditReceivingWallet && <><Text style={s.small}>{recipient ? t('Editar') : ''}</Text><Icon name="chevron-right" color={C.muted} size={22} /></>}
        </Pressable>
        {!!recipient && <Pressable testID="conversation-copy-receiving-wallet" accessibilityRole="button" accessibilityLabel={t('Copiar endereço da carteira')}
          accessibilityHint={recipient} onPress={() => void copyReceivingAddress()}
          style={({ pressed }) => [s.row, { gap: 12, minHeight: 44, opacity: pressed ? 0.65 : 1 }]}>
          <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{recipient.slice(0, 8)}…{recipient.slice(-8)}</Text><Icon name="copy" color={C.muted} size={20} />
        </Pressable>}
      </View>}
      {!finder && !!recipient && <Pressable testID="conversation-finder-wallet" accessibilityRole="button"
        accessibilityLabel={t('Copiar endereço da carteira')} accessibilityHint={recipient} onPress={() => void copyReceivingAddress()}
        style={[s.row, { gap: 12, paddingVertical: 16 }]}>
        <View style={{ flex: 1, gap: 5 }}><Text style={s.small}>{t('Carteira de recebimento confirmada.')}</Text>
          <Text style={s.body}>{recipient.slice(0, 8)}…{recipient.slice(-8)}</Text></View>
        <Icon name="copy" color={C.muted} size={20} />
      </Pressable>}
      {showFinishReturn && <Pressable testID="conversation-finish-return" accessibilityRole="button" accessibilityLabel={t('Finalizar devolução')}
        disabled={rewardQuery.isError} onPress={() => { Keyboard.dismiss(); setFinishReturn(true); }}
        style={({ pressed }) => ({ gap: 5, marginTop: 14, paddingTop: 30, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, opacity: pressed || rewardQuery.isError ? 0.65 : 1 })}>
        <View style={[s.row, { gap: 12 }]}><Text style={[s.h3, { flex: 1 }]}>{t('Finalizar devolução')}</Text><Icon name="chevron-right" color={C.muted} size={22} /></View>
        <Text style={s.body}>{t(!reward || reward.status === 'refunded' ? 'Adicione uma recompensa para pagar a quem encontrou.' : 'Libere a recompensa após receber seu objeto.')}</Text>
      </Pressable>}
      {historyFooter}
    </ScrollView>
    {report?.status === 'resolved' ? <Notice tone="success" text={t("Devolução confirmada. Obrigado por fazer parte deste reencontro!")} /> : report ? <>
      <View testID="conversation-composer" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Controller control={control} name="body" render={({ field }) => <View style={{ flex: 1 }}><ComposerInput accessibilityLabel={t('Mensagem')} editable={!busy} value={field.value} onChangeText={value => { field.onChange(value); drafts?.set(draftKey, value); }} onBlur={field.onBlur} placeholder={t('Escreva uma mensagem…')} placeholderTextColor={C.muted} selectionColor={C.accent} cursorColor={C.ink} multiline maxLength={2000} style={{ minHeight: 58, maxHeight: 112, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: C.input, color: C.ink, fontSize: 17, lineHeight: 24, textAlignVertical: 'center' }} />{!!errors.body?.message && <Text accessibilityRole="alert" style={[s.small, { color: C.red, marginTop: 6 }]}>{errors.body.message}</Text>}</View>} />
        <Button onPress={() => void handleSubmit(send)()} icon="send" label={t('Enviar')} busy={busy} disabled={!body.trim() || !!errors.body} style={{ width: 58, height: 58, minWidth: 58, minHeight: 58, paddingHorizontal: 0, paddingVertical: 0, flexShrink: 0, alignSelf: 'center' }} />
      </View>
    </> : null}
    {finder && details && report && <AccountActionSheet title={t('Detalhes do objeto')} onClose={() => setDetails(false)}>
      <View style={{ gap: 16 }}>
        <View style={[s.row, { alignItems: 'center' }]}>
          {item && <View style={[s.circle, { backgroundColor: item.color || C.surface }]}><Icon name={(item.categoryIcon || 'box') as IconName} color={categoryInk(item.color || C.surface)} size={26} /></View>}
          <View style={{ flex: 1, gap: 5 }}><Text style={s.h2}>{item?.name || report.tagName}</Text>
            {item && <Text style={s.body}>{tagCategoryLabel({ ...item, categoryDefaultKey: item.categoryDefaultKey ?? null }, t)}</Text>}
          </View>
          {item && <Pill status={item.status} />}
        </View>
        {!!item?.publicMessage && <View style={[s.card, { gap: 8 }]}><Text style={s.label}>{t('Mensagem do dono')}</Text><Text style={[s.body, { color: C.ink }]}>{item.publicMessage}</Text></View>}
      </View>
      <ConversationReward key={id} id={id} token={token} finder open={report.status === 'open'} onLocked={() => {}}
        amount={item?.rewardAmount} currency={item?.rewardCurrency} showReceivingWalletAction={false}
        onReleased={markResolved} />
    </AccountActionSheet>}
    {finder && receivingWallet && <ReceivingWalletSheet id={id} token={token} recipient={recipient} onClose={() => setReceivingWallet(false)} onSaved={recipient => {
      queryClient.setQueryData<ConversationRewardData>(apiQueryKey(token, `${path}/reward`), previous => previous ? { ...previous, recipient } : previous);
      setReceivingWallet(false);
      void conversation.refetch();
      ToastAndroid.show(t('Carteira de recebimento confirmada.'), ToastAndroid.SHORT);
    }} />}
    {!finder && finishReturn && rewardQuery.data && <RewardReleaseSheet tagId={rewardQuery.data.tagId} token={token} reportId={id} recipient={recipient || null}
      onConfigureReward={onViewItem && report ? () => { setFinishReturn(false); onViewItem(report, true); } : undefined}
      onClose={() => { setFinishReturn(false); void rewardQuery.refetch(); }}
      onChanged={reward => queryClient.setQueryData<ConversationRewardData>(apiQueryKey(token, `${path}/reward`), previous => previous ? { ...previous, reward } : previous)}
      onReleased={markResolved} />}
  </View></Animated.View>;
}
