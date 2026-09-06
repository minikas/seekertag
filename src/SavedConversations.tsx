import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';
import { finderConversations, listSavedConversations, SavedConversation } from './finder';
import { Button, C, Notice, s } from './ui';

export default function SavedConversations({ onOpen, onClose }: { onOpen: (id: string) => void; onClose?: () => void }) {
  const [items, setItems] = useState<SavedConversation[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [removing, setRemoving] = useState<string>();
  useEffect(() => { let live = true; void listSavedConversations().then(value => { if (live) setItems(value); }).catch(issue => { if (live) setError((issue as Error).message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  async function remove(id: string) { try { await finderConversations.remove(id); setItems(old => old.filter(item => item.id !== id)); setRemoving(undefined); } catch (issue) { setError((issue as Error).message); } }
  return <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 650, alignSelf: 'center', padding: 24, gap: 20 }}>
    <View style={s.between}><Text accessibilityRole="header" style={s.h2}>Minhas conversas</Text>{onClose && <Button label="Fechar conversas salvas" variant="ghost" icon="x" onPress={onClose} />}</View>
    <Text style={s.body}>{Platform.OS === 'web' ? 'Acessos salvos automaticamente por 30 dias neste navegador. Limpar os dados do site remove estes acessos.' : 'Acessos salvos automaticamente neste aplicativo. Conversas antigas aparecem depois de abrir seu link ou escanear a etiqueta novamente.'}</Text>
    {!!error && <Notice error text={error} />}
    {loading ? <ActivityIndicator color={C.purple} /> : !items.length ? <Notice text="Nenhuma conversa salva neste aparelho. Escaneie uma etiqueta para avisar o dono." /> : items.map(item => <View key={item.id} style={[s.card, { padding: 20, gap: 12 }]}>
      <Text style={s.h3}>{item.tagName}</Text><Text style={s.small}>{item.status === 'open' ? 'Em conversa' : 'Encerrada'}{item.expiresAt ? ` · Acesso até ${new Date(item.expiresAt).toLocaleDateString('pt-BR')}` : ''}</Text>
      <Button label={`Abrir conversa sobre ${item.tagName}`} onPress={() => onOpen(item.id)} icon="message-circle">Abrir conversa sobre {item.tagName}</Button>
      {removing === item.id ? <><Notice text="Isso remove o acesso deste aparelho. O endereço sozinho não permite voltar a esta conversa." /><Button variant="danger" onPress={() => void remove(item.id)}>Remover acesso</Button><Button variant="ghost" onPress={() => setRemoving(undefined)}>Cancelar</Button></> : <Button variant="ghost" onPress={() => setRemoving(item.id)}>Remover deste aparelho</Button>}
    </View>)}
  </ScrollView>;
}
