import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Screen from './Screen';
import Pressable from './HapticPressable';
import { objectCount } from './i18n';
import { categoryLabel, categoryInk } from './category.model';
import { api, Category } from './api';
import { Button, Field, Icon, IconName, Notice, Sheet, useUI } from './ui';

const icons: IconName[] = ['shopping-bag', 'briefcase', 'key', 'heart', 'headphones', 'box', 'smartphone', 'watch', 'book', 'camera', 'credit-card', 'umbrella', 'truck', 'home', 'coffee', 'tag'];
const colors = ['#304441', '#34434B', '#634457', '#5B4938', '#403D67', '#285569'];
const iconNames: Record<string, string> = { 'shopping-bag': 'Mochila', briefcase: 'Mala', key: 'Chaves', heart: 'Pet', headphones: 'Eletrônico', box: 'Outro', smartphone: 'Telefone', watch: 'Relógio', book: 'Livro', camera: 'Câmera', 'credit-card': 'Cartão', umbrella: 'Guarda-chuva', truck: 'Veículo', home: 'Casa', coffee: 'Café', tag: 'Etiqueta' };
export default function Categories({ token, onClose, onChanged, presentation = 'modal' }: { presentation?: 'screen' | 'modal'; token: string; onClose: () => void; onChanged: (categories: Category[]) => void }) {
  const { C, s, t, locale } = useUI();
  const Frame = presentation === 'screen' ? Screen : Sheet;
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const result = await api<{ categories: Category[] }>('/categories', token);
    setCategories(result.categories); onChanged(result.categories);
  }, [token, onChanged]);
  useEffect(() => {
    let live = true;
    void api<{ categories: Category[] }>('/categories', token).then(result => { if (live) setCategories(result.categories); })
      .catch(cause => { if (live) setError((cause as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);
  return <Frame contentKey={editing ? editing === 'new' ? 'new' : editing.id : 'categories'} title={editing ? editing === 'new' ? t("Nova categoria") : t("Editar categoria") : t("Categorias")} onClose={() => editing ? setEditing(null) : onClose()}>
    {editing ? <CategoryEditor key={editing === 'new' ? 'new' : editing.id} token={token} category={editing === 'new' ? undefined : editing} categories={categories} onSaved={async () => { await refresh(); setEditing(null); }} /> : <>
      <Text style={s.body}>{t("Organize seus objetos do seu jeito.")}</Text>
      <Button icon="plus" onPress={() => setEditing('new')}>{t("Criar categoria")}</Button>
      {loading && <ActivityIndicator color={C.accent} />}
      {categories.map(category => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={t("Editar {name}", { name: categoryLabel(category, t) })} onPress={() => setEditing(category)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: C.line, opacity: pressed ? 0.6 : 1 })}>
        <View style={[s.settingsIcon, { backgroundColor: category.color }]}><Icon name={category.icon as IconName} color={categoryInk(category.color)} size={20} /></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={s.h3}>{categoryLabel(category, t)}</Text><Text style={s.small}>{objectCount(t, category.tagCount, locale)}</Text></View><Icon name="edit-2" size={18} color={C.muted} />
      </Pressable>)}
      {!loading && !categories.length && <Text style={s.body}>{t("Crie sua primeira categoria.")}</Text>}
      {!!error && <><Notice error text={error} /><Button variant="secondary" onPress={() => { setError(''); void refresh().catch(cause => setError(cause.message)); }}>{t("Tentar novamente")}</Button></>}
    </>}
  </Frame>;
}

function CategoryEditor({ token, category, categories, onSaved }: { token: string; category?: Category; categories: Category[]; onSaved: () => Promise<void> }) {
  const { C, s, t, locale } = useUI();
  const [name, setName] = useState(category ? categoryLabel(category, t) : '');
  const [icon, setIcon] = useState<IconName>((category?.icon || 'tag') as IconName);
  const [color, setColor] = useState(category?.color || colors[0]);
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(remove = false) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (remove && category) await api(`/categories/${category.id}`, token, { replacementId: replacement || undefined }, 'DELETE');
      else await api(category ? `/categories/${category.id}` : '/categories', token, { name: category && name === categoryLabel(category, t) ? category.name : name.trim(), icon, color }, category ? 'PATCH' : 'POST');
      await onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 24 }}>
    {deleting && category ? <>
      <Text style={s.h2}>{t("Excluir categoria?")}</Text>
      <Text style={s.body}>{category.tagCount ? t("Escolha para onde mover os objetos. As etiquetas e os QRs serão mantidos.") : t("Esta categoria não tem objetos e será removida da sua lista.")}</Text>
      {category.tagCount > 0 && categories.filter(c => c.id !== category.id).map(c => <Button key={c.id} variant={replacement === c.id ? 'primary' : 'secondary'} onPress={() => setReplacement(c.id)} disabled={busy}>{categoryLabel(c, t)}</Button>)}
      {category.tagCount > 0 && categories.length < 2 && <Notice text={t("Crie outra categoria antes de excluir esta.")} />}
      <Button variant="danger" icon="trash-2" onPress={() => void save(true)} busy={busy} disabled={category.tagCount > 0 && !replacement}>{t("Excluir categoria")}</Button>
      <Button variant="secondary" disabled={busy} onPress={() => setDeleting(false)}>{t("Cancelar")}</Button>
    </> : <>
      <Field testID="category-name" label={t("Nome da categoria")} placeholder={t("Ex.: Bicicleta")} value={name} onChangeText={setName} selectTextOnFocus={!!category} maxLength={32} editable={!busy} />
      <Text style={s.label}>{t("Ícone")}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{icons.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t("Ícone {name}", { name: t(iconNames[value]) })} accessibilityState={{ selected: icon === value, disabled: busy }} disabled={busy} onPress={() => setIcon(value)} style={[s.settingsIcon, { width: 48, height: 48, backgroundColor: icon === value ? C.primary : C.secondary }]}><Icon name={value} color={icon === value ? C.onPrimary : C.ink} /></Pressable>)}</View>
      <Text style={s.label}>{t("Cor")}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{colors.map((value, index) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t("Cor {number}", { number: index + 1 })} accessibilityState={{ selected: color === value, disabled: busy }} disabled={busy} onPress={() => setColor(value)} style={[s.settingsIcon, { width: 48, height: 48, backgroundColor: value, borderColor: C.ink, borderWidth: color === value ? 2 : 0 }]}>{color === value && <Icon name="check" color={categoryInk(value)} />}</Pressable>)}</View>
      <Button icon="check" onPress={() => void save()} busy={busy} disabled={!name.trim()}>{t("Salvar categoria")}</Button>
      {category && <Button variant="danger" icon="trash-2" disabled={busy} onPress={() => setDeleting(true)}>{t("Excluir categoria")}</Button>}
    </>}
    {!!error && <Notice error text={error} />}
  </View>;
}
