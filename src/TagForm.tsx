import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, Tag } from './api';
import { completeMutation, executeMutation, isDefiniteMutationRejection, loadPendingMutation, PendingMutation, prepareMutation } from './mutations';
import { Button, categories, C, Field, Icon, Notice, Sheet, s } from './ui';

type TagPayload = { name: string; category: string; color: string; description: string; publicMessage: string; rewardAmount: number; rewardCurrency: string };
type Props = { token: string; ownerId: string; tag?: Tag; onClose: () => void; onSaved: (tag: Tag) => void };
const defaultMessage = 'Encontrou este objeto? Envie uma mensagem para combinar a devolução.';

export default function TagForm({ token, ownerId, tag, onClose, onSaved }: Props) {
  const [name, setName] = useState(tag?.name || '');
  const [category, setCategory] = useState(tag && categories.some(c => c.name === tag.category) ? tag.category : 'Outro');
  const [description, setDescription] = useState(tag?.description || '');
  const [publicMessage, setPublicMessage] = useState(tag?.publicMessage ?? defaultMessage);
  const [reward, setReward] = useState(tag?.rewardAmount ? String(tag.rewardAmount) : '');
  const [currency, setCurrency] = useState(tag?.rewardCurrency || 'BRL');
  const [extras, setExtras] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!!tag); const [pending, setPending] = useState<PendingMutation<TagPayload> | null>(null);
  const active = useRef(false); const identity = useRef(`${ownerId}:${token}:${tag?.id || 'new'}`); const mounted = useRef(true);
  identity.current = `${ownerId}:${token}:${tag?.id || 'new'}`;
  const scope = `tags:create:${ownerId}`;
  useEffect(() => {
    mounted.current = true; let live = true;
    if (!tag) void loadPendingMutation<TagPayload>(scope).then(saved => {
      if (!live) return;
      if (saved) { setPending(saved); setName(saved.payload.name); setCategory(saved.payload.category); setDescription(saved.payload.description); setPublicMessage(saved.payload.publicMessage); setReward(saved.payload.rewardAmount ? String(saved.payload.rewardAmount) : ''); setCurrency(saved.payload.rewardCurrency); }
      setReady(true);
    }).catch(e => { if (live) { setError((e as Error).message); setReady(true); } });
    return () => { live = false; mounted.current = false; };
  }, [scope, tag?.id]);

  async function save() {
    if (active.current || !ready) return;
    if (!name.trim()) { setError('Dê um nome ao objeto.'); return; }
    const amount = reward.trim() ? Number(reward.replace(',', '.')) : 0;
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) { setExtras(true); setError('Informe uma recompensa entre 0 e 100.000.'); return; }
    const requestIdentity = identity.current;
    const isCurrent = () => mounted.current && identity.current === requestIdentity;
    active.current = true; setBusy(true); setError('');
    let submitted: PendingMutation<TagPayload> | null = null;
    try {
      const payload: TagPayload = { name: name.trim(), category, color: categories.find(c => c.name === category)?.color || categories[5].color, description, publicMessage, rewardAmount: amount, rewardCurrency: currency };
      if (tag) {
        const { tag: saved } = await api<{ tag: Tag }>(`/tags/${tag.id}`, token, payload, 'PATCH');
        if (isCurrent()) onSaved(saved);
      } else {
        const operation = pending || await prepareMutation<TagPayload>(scope, '/tags', payload);
        submitted = operation;
        if (isCurrent()) setPending(operation);
        const { tag: saved } = await executeMutation<{ tag: Tag }>(operation, token);
        if (isCurrent()) { await completeMutation(operation); if (isCurrent()) onSaved(saved); }
      }
    } catch (e) {
      if (submitted && isDefiniteMutationRejection(e)) { await completeMutation(submitted).catch(() => {}); if (isCurrent()) setPending(null); }
      if (isCurrent()) setError((e as Error).message);
    }
    finally { active.current = false; if (isCurrent()) setBusy(false); }
  }
  const locked = busy || !!pending;
  return <Sheet title={tag ? 'Editar objeto' : 'Criar etiqueta'} onClose={onClose} footer={<Button onPress={save} busy={busy} disabled={!ready} icon={tag ? 'check' : 'plus'}>{tag ? 'Salvar alterações' : pending ? 'Recuperar criação anterior' : 'Criar etiqueta'}</Button>}>
    {!!error && <Notice error text={error} />}
    {!!pending && <Notice text="Há uma criação sem confirmação neste aparelho. Recupere o resultado antes de criar outra etiqueta." />}
    <Field label="Nome do objeto" placeholder="Ex.: Minha mochila" value={name} onChangeText={setName} maxLength={80} autoFocus editable={!locked} onSubmitEditing={save} returnKeyType="done" />
    <View style={{ gap: 8 }}><Text style={s.label}>Categoria</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{categories.map(c => <Pressable key={c.name} accessibilityRole="button" accessibilityLabel={c.name} accessibilityState={{ selected: c.name === category, disabled: locked }} disabled={locked} onPress={() => setCategory(c.name)} style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 11, minHeight: 44, alignItems: 'center', borderWidth: 1, borderRadius: 11, backgroundColor: c.name === category ? C.soft : C.surface, borderColor: c.name === category ? C.purple : C.line }}><Icon name={c.icon} size={15} color={c.name === category ? C.purple : C.muted} /><Text style={{ color: c.name === category ? C.purple : C.ink, fontSize: 12 }}>{c.name}</Text></Pressable>)}</View></View>
    <Button variant="ghost" icon={extras ? 'chevron-up' : 'chevron-down'} expanded={extras} onPress={() => setExtras(!extras)}>{extras ? 'Menos opções' : 'Mais opções'}</Button>
    {extras && <>
      <Field label="Anotação particular (opcional)" placeholder="Modelo, cor ou outro detalhe" value={description} onChangeText={setDescription} maxLength={500} help="Só você vê esta anotação." editable={!locked} />
      <Field label="Mensagem na etiqueta" multiline value={publicMessage} onChangeText={setPublicMessage} maxLength={500} help="Quem abrir o QR verá esta mensagem. Evite telefone ou endereço." editable={!locked} />
      <View style={s.divider} /><Text style={s.h3}>Recompensa opcional</Text>
      <Text style={s.small}>O valor é uma promessa combinada na conversa. O aplicativo não recebe nem transfere dinheiro.</Text>
      <Field label="Valor da recompensa (opcional)" value={reward} onChangeText={setReward} keyboardType="decimal-pad" placeholder="0,00" maxLength={12} editable={!locked} />
      <View style={s.row}>{['BRL', 'USDC', 'SKR'].map(c => <Button key={c} variant={c === currency ? 'primary' : 'secondary'} onPress={() => setCurrency(c)} disabled={locked}>{c === 'BRL' ? 'R$' : c}</Button>)}</View>
    </>}
  </Sheet>;
}
