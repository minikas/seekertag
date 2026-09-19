import React, { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Keyboard, Text, View } from 'react-native';
import AccountActionSheet, { AccountActionSheetHandle } from './AccountActionSheet';
import Screen from './Screen';
import ScreenBottomSheet from './ScreenBottomSheet';
import Pressable from './HapticPressable';
import { objectCount } from './i18n';
import { categoryLabel, categoryInk } from './category.model';
import { api, Category } from './api';
import { apiQueryOptions, invalidateApiResources, queryClient } from './query';
import { Button, Field, Icon, IconName, Notice, Sheet, useUI } from './ui';
import { categoryFormSchema, type CategoryFormValues } from './form.model';

const icons: IconName[] = ['shopping-bag', 'briefcase', 'key', 'heart', 'headphones', 'box', 'smartphone', 'watch', 'book', 'camera', 'credit-card', 'umbrella', 'truck', 'home', 'coffee', 'tag'];
const colors = ['#304441', '#34434B', '#634457', '#5B4938', '#403D67', '#285569'];
const iconNames: Record<string, string> = { 'shopping-bag': 'Mochila', briefcase: 'Mala', key: 'Chaves', heart: 'Pet', headphones: 'Eletrônico', box: 'Outro', smartphone: 'Telefone', watch: 'Relógio', book: 'Livro', camera: 'Câmera', 'credit-card': 'Cartão', umbrella: 'Guarda-chuva', truck: 'Veículo', home: 'Casa', coffee: 'Café', tag: 'Etiqueta' };
export default function Categories({ token, onClose, onChanged, presentation = 'modal' }: { presentation?: 'screen' | 'modal' | 'sheet'; token: string; onClose: () => void; onChanged?: (categories: Category[]) => void }) {
  const { C, s, t, locale } = useUI();
  const Frame = presentation === 'screen' ? Screen : Sheet;
  const sheetRef = useRef<AccountActionSheetHandle>(null);
  const editingState = useRef({ dirty: false, busy: false });
  const categoriesQuery = useQuery(apiQueryOptions<{ categories: Category[] }>('/categories', token));
  const categories = categoriesQuery.data?.categories ?? [];
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const loading = categoriesQuery.isPending;
  const error = categoriesQuery.error?.message;
  const guardEditor = (finish: () => void) => {
    if (editingState.current.busy) return;
    if (editing && editingState.current.dirty) Alert.alert(t('Descartar alterações?'), t('As alterações não salvas serão perdidas.'), [
      { text: t('Continuar editando'), style: 'cancel' }, { text: t('Descartar'), style: 'destructive', onPress: finish },
    ]); else finish();
  };
  const editor = editing ? <CategoryEditor key={editing === 'new' ? 'new' : editing.id} token={token} category={editing === 'new' ? undefined : editing} categories={categories} presentation={presentation === 'sheet' ? 'inline' : 'modal'}
    stateRef={editingState} onClose={() => { editingState.current = { dirty: false, busy: false }; setEditing(null); }} onSaved={async () => {
      const result = await queryClient.ensureQueryData(apiQueryOptions<{ categories: Category[] }>('/categories', token));
      onChanged?.(result.categories); editingState.current = { dirty: false, busy: false }; setEditing(null);
    }} /> : null;
  const list = <>
      <Text style={s.body}>{t("Organize seus objetos do seu jeito.")}</Text>
      <Button icon="plus" onPress={() => setEditing('new')}>{t("Criar categoria")}</Button>
      {loading && <CategoryListSkeleton />}
      {categories.map(category => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={t("Editar {name}", { name: categoryLabel(category, t) })} onPress={() => setEditing(category)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: C.line, opacity: pressed ? 0.6 : 1 })}>
        <View style={[s.settingsIcon, { backgroundColor: category.color }]}><Icon name={category.icon as IconName} color={categoryInk(category.color)} size={20} /></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={s.h3}>{categoryLabel(category, t)}</Text><Text style={s.small}>{objectCount(t, category.tagCount, locale)}</Text></View><Icon name="edit-2" size={18} color={C.muted} />
      </Pressable>)}
      {!loading && !categories.length && <Text style={s.body}>{t("Crie sua primeira categoria.")}</Text>}
      {!!error && <><Notice error text={error} /><Button variant="secondary" onPress={() => void categoriesQuery.refetch()}>{t("Tentar novamente")}</Button></>}
  </>;
  if (presentation === 'sheet') return <AccountActionSheet ref={sheetRef} title={editing ? t(editing === 'new' ? 'Nova categoria' : 'Editar categoria') : t('Categorias')} onClose={onClose}
    guardClose={guardEditor} onBack={editing ? () => guardEditor(() => { setEditing(null); editingState.current = { dirty: false, busy: false }; }) : undefined}>
    <View style={{ display: editing ? 'none' : 'flex', gap: 20 }}>{list}</View>{editor}
  </AccountActionSheet>;
  return <Frame title={t('Categorias')} onClose={onClose} overlay={editor}>{list}</Frame>;
}

function CategoryListSkeleton() {
  const { C } = useUI();
  return <View accessibilityLabel="Carregando categorias" style={{ gap: 20 }}>
    {[0, 1, 2].map(index => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: C.surface }} />
      <View style={{ flex: 1, gap: 8 }}><View style={{ width: `${48 + index * 9}%`, height: 18, borderRadius: 9, backgroundColor: C.surface }} /><View style={{ width: '30%', height: 14, borderRadius: 7, backgroundColor: C.surface }} /></View>
    </View>)}
  </View>;
}

function CategoryEditor({ token, category, categories, onSaved, onClose, presentation, stateRef }: { token: string; category?: Category; categories: Category[]; onSaved: () => Promise<void>; onClose: () => void; presentation: 'inline' | 'modal'; stateRef: React.RefObject<{ dirty: boolean; busy: boolean }> }) {
  const Frame = presentation === 'inline' ? InlineCategoryFrame : CategorySheet;
  const { C, s, t, locale } = useUI();
  const { control, handleSubmit, watch, formState: { errors, isDirty } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema), mode: 'onChange', defaultValues: { name: category ? categoryLabel(category, t) : '' },
  });
  const name = watch('name');
  const [icon, setIcon] = useState<IconName>((category?.icon || 'tag') as IconName);
  const [color, setColor] = useState(category?.color || colors[0]);
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState('');
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const saveMutation = useMutation({
    mutationFn: (values: CategoryFormValues) => api(category ? `/categories/${category.id}` : '/categories', token,
      { name: category && values.name === categoryLabel(category, t) ? category.name : values.name, icon, color }, category ? 'PATCH' : 'POST'),
    onSuccess: async () => { await invalidateApiResources(token, ['/categories', '/tags', '/reports', '/public/tags']); await onSaved(); },
    retry: false,
  });
  const deleteMutation = useMutation({
    mutationFn: () => api(`/categories/${category!.id}`, token, { replacementId: replacement || undefined }, 'DELETE'),
    onSuccess: async () => { await invalidateApiResources(token, ['/categories', '/tags', '/reports', '/public/tags']); await onSaved(); },
    retry: false,
  });
  const busy = saveMutation.isPending || deleteMutation.isPending;
  const dirty = isDirty || icon !== (category?.icon || 'tag') || color !== (category?.color || colors[0]);
  stateRef.current = { dirty, busy };
  const guardClose = (finish: () => void) => {
    if (busy || submitting.current) return;
    if (dirty) Alert.alert(t('Descartar alterações?'), t('As alterações não salvas serão perdidas.'), [
      { text: t('Continuar editando'), style: 'cancel' }, { text: t('Descartar'), style: 'destructive', onPress: finish },
    ]); else finish();
  };
  async function submit(values: CategoryFormValues) {
    if (busy || submitting.current) return;
    submitting.current = true; stateRef.current.busy = true; setError('');
    try {
      await saveMutation.mutateAsync(values);
    } catch (cause) { setError((cause as Error).message); }
    finally { submitting.current = false; stateRef.current.busy = false; }
  }
  function save() { void handleSubmit(submit)(); }
  async function remove() {
    if (!category || busy || submitting.current) return;
    submitting.current = true; stateRef.current.busy = true; setError('');
    try { await deleteMutation.mutateAsync(); }
    catch (cause) { setError((cause as Error).message); }
    finally { submitting.current = false; stateRef.current.busy = false; }
  }
  return <Frame guardClose={guardClose} title={category ? t('Editar categoria') : t('Nova categoria')} onClose={() => { if (busy) return; if (deleting) { setDeleting(false); setError(''); } else onClose(); }}
    dismissible={!busy} overlay={deleting && category ? <ScreenBottomSheet title={t('Excluir categoria?')} dismissible={!busy} onClose={() => { if (!busy) { setDeleting(false); setError(''); } }}>
      <Text style={s.body}>{category.tagCount ? t("Escolha para onde mover os objetos. As etiquetas e os QRs serão mantidos.") : t("Esta categoria não tem objetos e será removida da sua lista.")}</Text>
      {category.tagCount > 0 && categories.filter(c => c.id !== category.id).map(c => <Button key={c.id} variant={replacement === c.id ? 'primary' : 'secondary'} onPress={() => setReplacement(c.id)} disabled={busy}>{categoryLabel(c, t)}</Button>)}
      {category.tagCount > 0 && categories.length < 2 && <Notice text={t("Crie outra categoria antes de excluir esta.")} />}
      <Button variant="danger" icon="trash-2" onPress={() => void remove()} busy={busy} disabled={category.tagCount > 0 && !replacement}>{t("Excluir categoria")}</Button>
      <Button variant="secondary" disabled={busy} onPress={() => { setDeleting(false); setError(''); }}>{t("Cancelar")}</Button>
      {!!error && <Notice error text={error} />}
    </ScreenBottomSheet> : undefined}>
      <Controller control={control} name="name" render={({ field }) => <Field inSheet testID="category-name" label={t("Nome da categoria")} placeholder={t("Ex.: Bicicleta")} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.name?.message} selectTextOnFocus={!!category} maxLength={32} editable={!busy} />} />
      <Text style={s.label}>{t("Ícone")}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{icons.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t("Ícone {name}", { name: t(iconNames[value]) })} accessibilityState={{ selected: icon === value, disabled: busy }} disabled={busy} onPress={() => setIcon(value)} style={[s.settingsIcon, { width: 48, height: 48, backgroundColor: icon === value ? C.primary : C.secondary }]}><Icon name={value} color={icon === value ? C.onPrimary : C.ink} /></Pressable>)}</View>
      <Text style={s.label}>{t("Cor")}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{colors.map((value, index) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t("Cor {number}", { number: index + 1 })} accessibilityState={{ selected: color === value, disabled: busy }} disabled={busy} onPress={() => setColor(value)} style={[s.settingsIcon, { width: 48, height: 48, backgroundColor: value, borderColor: C.ink, borderWidth: color === value ? 2 : 0 }]}>{color === value && <Icon name="check" color={categoryInk(value)} />}</Pressable>)}</View>
      <View style={[s.row, { gap: 12 }]}>
        <Button style={{ flex: 1 }} icon="check" onPress={save} busy={busy} disabled={!name.trim() || !!errors.name}>{t("Salvar categoria")}</Button>
        {category && <Button variant="danger" icon="trash-2" label={t('Excluir categoria')} disabled={busy} onPress={() => { Keyboard.dismiss(); setError(''); setDeleting(true); }} />}
      </View>
      {!!error && !deleting && <Notice error text={error} />}
  </Frame>;
}

function InlineCategoryFrame({ children, overlay }: React.PropsWithChildren<{ title: string; onClose: () => void; dismissible?: boolean; guardClose: (finish: () => void) => void; overlay?: React.ReactNode }>) {
  return <View style={{ gap: 20 }}>{children}{overlay}</View>;
}
function CategorySheet({ children, overlay, dismissible = true, ...props }: React.ComponentProps<typeof InlineCategoryFrame>) {
  return <AccountActionSheet {...props} busy={!dismissible}>{children}{overlay}</AccountActionSheet>;
}
