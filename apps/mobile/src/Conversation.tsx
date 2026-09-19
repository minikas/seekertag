import React, { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppState, ScrollView, Text, TextInput, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { api, Message, Report } from './api';
import { Button, Icon, Notice, useUI } from './ui';
import { messageFormSchema, type MessageFormValues } from './form.model';
import AccountActionSheet from './AccountActionSheet';
import ConversationReward from './ConversationReward';
import { useNotifications } from './NotificationsProvider';

export default function Conversation({ id, token, finder = false, presentation = 'page' }: { id: string; token: string; finder?: boolean; presentation?: 'page' | 'sheet' }) {
  const { C, s, t, locale } = useUI();
  const { markRead, setActiveReport } = useNotifications();
  const readThrough = useRef(0);
  useEffect(() => { setActiveReport(id); readThrough.current = 0; return () => setActiveReport(undefined); }, [id, setActiveReport]);
  const [report, setReport] = useState<Report>(); const [messages, setMessages] = useState<Message[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<MessageFormValues>({ resolver: zodResolver(messageFormSchema), mode: 'onChange', defaultValues: { body: '' } });
  const body = watch('body');
  const scroll = useRef<ScrollView>(null); const generation = useRef(0);
  const path = finder ? `/finder/reports/${id}` : `/reports/${id}`;
  useEffect(() => { let live = true; let fetching = false; setReport(undefined); setMessages([]); reset({ body: '' }); setBusy(false); setError(''); const current = ++generation.current; async function load() { if (fetching || AppState.currentState !== 'active') return; fetching = true; try { const data = await api<{ report: Report; messages: Message[] }>(path, token); if (live && current === generation.current) { setReport(data.report); setMessages(data.messages); setError(''); } } catch(e) { if (live) setError((e as Error).message); } finally { fetching = false; } } load(); const timer = setInterval(load, 4000); return () => { live = false; clearInterval(timer); }; }, [path, token, reset]);
  useEffect(() => {
    const last = messages.filter(message => message.role !== (finder ? 'finder' : 'owner')).at(-1)?.id;
    if (last && last > readThrough.current && AppState.currentState === 'active') {
      readThrough.current = last;
      void markRead(last, id).then(saved => { if (!saved && readThrough.current === last) readThrough.current = 0; });
    }
  }, [messages, finder, id, markRead]);
  async function send(values: MessageFormValues) { if (busy) return; setBusy(true); setError(''); const current = generation.current; try { const { message } = await api<{ message: Message }>(`${path}/messages`, token, { body: values.body }); if (current === generation.current) { setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]); reset({ body: '' }); } } catch(e) { if (current === generation.current) setError((e as Error).message); } finally { if (current === generation.current) setBusy(false); } }
  const sheet = presentation === 'sheet';
  const ComposerInput = sheet ? BottomSheetTextInput : TextInput;
  return <View style={{ flex: 1, gap: 14, minHeight: sheet ? 0 : 440 }}>
    {!sheet && <View style={{ gap: 5 }}>
      <View style={s.between}><Text style={[s.h3, { flex: 1 }]}>{report?.tagName || t("Conversa privada")}</Text>
        {finder && report && <Button variant="ghost" icon="tag" label={t('Ver objeto')} onPress={() => setDetails(true)} />}
      </View>
      <View style={s.row}>
        <Text style={s.small}>{finder ? t("Você está falando com o dono.") : t("Com {name}", { name: report?.finderName || t("quem encontrou") })}</Text>
        <View style={[s.row, { gap: 5 }]}><Icon name="shield" size={14} color={C.accent} /><Text style={{ color: C.accent, fontSize: 12, fontWeight: '600' }}>{t("Contatos protegidos")}</Text></View>
      </View>
    </View>}
    {!!error && <Notice error text={error} />}
    {!report && !error ? <View accessibilityLabel={t("Carregando conversa")} style={{ gap: 14, paddingVertical: 10 }}>
      <View style={{ width: '78%', height: 54, borderRadius: 16, backgroundColor: C.surface }} />
      <View style={{ width: '58%', height: 42, borderRadius: 16, backgroundColor: C.surface, alignSelf: 'flex-end' }} />
      <View style={{ width: '70%', height: 58, borderRadius: 16, backgroundColor: C.surface }} />
    </View> : null}
    <ScrollView ref={scroll} style={{ maxHeight: sheet ? 300 : 360, minHeight: sheet ? 180 : 220, display: report ? 'flex' : 'none' }} contentContainerStyle={{ paddingVertical: 6, gap: 14 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
      {messages.map(message => { const own = message.role === (finder ? 'finder' : 'owner'); return <View key={message.id} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 5 }}><View style={{ backgroundColor: own ? C.primary : C.surface, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, borderBottomRightRadius: own ? 4 : 16, borderBottomLeftRadius: own ? 16 : 4 }}><Text style={{ color: own ? C.onPrimary : C.ink, fontSize: 17, lineHeight: 25 }}>{message.body}</Text></View><Text style={[s.small, { fontSize: 12, alignSelf: own ? 'flex-end' : 'flex-start' }]}>{own ? t("Você") : message.role === 'owner' ? t("Dono") : report?.finderName || t("Quem encontrou")} · {new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</Text></View>; })}
    </ScrollView>
    {report?.status === 'resolved' ? <Notice tone="success" text={t("Devolução confirmada. Obrigado por fazer parte deste reencontro!")} /> : report ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Controller control={control} name="body" render={({ field }) => <View style={{ flex: 1 }}><ComposerInput accessibilityLabel={t('Mensagem')} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder={t('Escreva uma mensagem…')} placeholderTextColor={C.muted} selectionColor={C.accent} cursorColor={C.ink} multiline maxLength={2000} style={{ minHeight: 58, maxHeight: 112, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: C.input, color: C.ink, fontSize: 17, lineHeight: 24, textAlignVertical: 'center' }} />{!!errors.body?.message && <Text accessibilityRole="alert" style={[s.small, { color: C.red, marginTop: 6 }]}>{errors.body.message}</Text>}</View>} />
        <Button onPress={() => void handleSubmit(send)()} icon="send" label={t('Enviar')} busy={busy} disabled={!body.trim() || !!errors.body} style={{ minWidth: 58, paddingHorizontal: 14, alignSelf: 'center' }} />
      </View>
    </> : null}
    {finder && details && report && <AccountActionSheet title={report.tagName} onClose={() => setDetails(false)}>
      <ConversationReward key={id} id={id} token={token} finder open={report.status === 'open'} onLocked={() => {}}
        onReleased={() => setReport(previous => previous ? { ...previous, status: 'resolved' } : previous)} />
    </AccountActionSheet>}
  </View>;
}
