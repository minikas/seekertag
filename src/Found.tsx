import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api, Report, Tag } from './api';
import Conversation from './Conversation';
import { PublicReward } from './Rewards';
import { secureStorage } from './platform/storage';
import { Brand, Button, categoryInfo, C, Field, Icon, Notice, s } from './ui';

export default function Found({ code, chatId, goHome, goChat }: { code?: string; chatId?: string; goHome: () => void; goChat: (id: string) => void }) {
  const [tag, setTag] = useState<Tag>(); const [finderName, setFinderName] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [chatToken, setChatToken] = useState<string | null>(null);
  useEffect(() => { let live = true; setLoading(true); setError(''); setTag(undefined); setChatToken(null); async function load() { try { if (chatId) { const token = await secureStorage.get(`finder-${chatId}`); if (!token) throw new Error('Esta conversa está disponível no navegador em que você avisou o dono. Se você limpou os dados do site ou está em outro navegador, escaneie a etiqueta e envie um novo aviso.'); if (live) setChatToken(token); } else if (code) { const previous = await secureStorage.get(`tag-chat-${code}`); if (previous) { const saved = await secureStorage.get(`finder-${previous}`); if (saved) { const existing = await api<{ report: Report }>(`/finder/reports/${previous}`, saved); if (existing.report.status === 'open') { if (live) goChat(previous); return; } await secureStorage.remove(`tag-chat-${code}`); } } const result = await api<{ tag: Tag }>(`/public/tags/${encodeURIComponent(code)}`); if(live) setTag(result.tag); } } catch(e) { if(live) setError((e as Error).message); } finally { if(live) setLoading(false); } } load(); return () => { live = false; }; }, [code, chatId]);
  async function submit() { if (!message.trim()) { setError('Escreva uma mensagem para avisar onde encontrou o objeto.'); return; } setError(''); setBusy(true); try { const result = await api<{ report: Report; token: string }>(`/public/tags/${code}/reports`, null, { finderName: finderName.trim() || 'Uma pessoa que quer ajudar', message: message.trim() }); await secureStorage.set(`finder-${result.report.id}`, result.token); await secureStorage.set(`tag-chat-${code}`, result.report.id); goChat(result.report.id); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  const cat = categoryInfo(tag?.category || 'Outro');
  return <ScrollView style={{ backgroundColor: C.bg, flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 22, paddingTop: 30, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"><View style={{ width: '100%', maxWidth: 480, gap: 30 }}><View style={s.between}><Brand /><Button variant="ghost" icon="home" onPress={goHome} label="Página inicial" /></View>
    <View style={[s.card, { padding: 26, gap: 22 }]}>
      {loading && <ActivityIndicator color={C.purple} />}
      {!!error && <Notice error text={error} />}
      {chatId && chatToken ? <><View style={{ gap: 9 }}><Text accessibilityRole="header" style={s.h2}>Obrigado por ajudar.</Text></View><Conversation id={chatId} token={chatToken} finder /></> : tag ? <>
        <View style={{ alignItems: 'center', gap: 16, paddingVertical: 15 }}><View style={[s.circle, { backgroundColor: cat.color, width: 92, height: 92, borderRadius: 28 }]}><Icon name={cat.icon} size={39} /></View><Text accessibilityRole="header" style={[s.h1, { fontSize: 30, textAlign: 'center' }]}>{tag.name}</Text><Text style={[s.body, { textAlign: 'center' }]}>Encontrou este objeto? Você pode fazer o dia de alguém melhor.</Text></View>
        {tag.publicMessage ? <View style={{ padding: 17, borderRadius: 14, backgroundColor: C.bg, gap: 7 }}><Text style={[s.body, { color: C.ink }]}>{tag.publicMessage}</Text></View> : null}
        <PublicReward key={tag.code} tag={tag} />
        <Field label="Como podemos te chamar? (opcional)" value={finderName} onChangeText={setFinderName} placeholder="Seu primeiro nome ou apelido" maxLength={60} />
        <Field label="Mensagem para o dono" value={message} onChangeText={setMessage} placeholder="Oi! Encontrei seu objeto. Podemos combinar a devolução por aqui." multiline maxLength={2000} />
        <Button onPress={submit} busy={busy} icon="send">Avisar o dono</Button>
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={16} color={C.purple} /><Text style={[s.small, { flex: 1 }]}>A conversa acontece aqui. Seu telefone, e-mail e localização não são pedidos nem compartilhados automaticamente.</Text></View>
      </> : null}
    </View>
  </View></ScrollView>;
}
