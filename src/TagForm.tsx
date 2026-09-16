import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import {
  BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetFooter, BottomSheetFooterProps,
  BottomSheetHandle, BottomSheetHandleProps, BottomSheetModal,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Category, Tag } from './api';
import { Button, Field, Icon, IconName, Notice, useUI } from './ui';
import Categories from './Categories';
import { categoryLabel } from './category.model';
import KeyboardAwareSheetScrollView from './KeyboardAwareSheetScrollView';

export default function TagForm({ token, tag, onClose, onSaved, onCategoriesChanged }: { token: string; tag?: Tag; onClose: () => void; onSaved: (tag: Tag) => void; onCategoriesChanged: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const sheet = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ['78%', '96%'], []);
  const saving = useRef(false);
  const closing = useRef(false);
  const mounted = useRef(false);
  const savedTag = useRef<Tag | null>(null);
  const [name, setName] = useState(tag?.name || '');
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState(tag?.categoryId || '');
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [managingCategories, setManagingCategories] = useState(false);
  const [description, setDescription] = useState(tag?.description || '');
  const [publicMessage, setPublicMessage] = useState(tag?.publicMessage || t("Obrigado por cuidar do que é importante para mim. Me envie uma mensagem para combinarmos a devolução."));
  const [reward, setReward] = useState(tag?.rewardAmount ? String(tag.rewardAmount) : '');
  const [currency, setCurrency] = useState(tag?.rewardCurrency || 'BRL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [footerHeight, setFooterHeight] = useState(90 + insets.bottom);
  const applyCategories = useCallback((next: Category[]) => {
    setCategories(next);
    setCategory(current => next.some(c => c.id === current) ? current : next[0]?.id || '');
  }, []);
  useEffect(() => {
    let live = true;
    void api<{ categories: Category[] }>('/categories', token).then(result => { if (live) applyCategories(result.categories); })
      .catch(cause => { if (live) setError(cause.message); }).finally(() => { if (live) setCategoriesLoading(false); });
    return () => { live = false; };
  }, [token, applyCategories]);

  const close = useCallback(() => {
    if (saving.current || closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    sheet.current?.dismiss();
  }, []);

  useEffect(() => {
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else close();
      return true;
    });
    return () => { mounted.current = false; back.remove(); modal?.dismiss(); };
  }, [close]);

  function finishDismiss() {
    if (!mounted.current) return;
    Keyboard.dismiss();
    if (savedTag.current) onSaved(savedTag.current);
    else onClose();
  }

  async function save() {
    if (saving.current || closing.current) return;
    if (categoriesLoading || !category) { setError('Escolha uma categoria.'); return; }
    if (!name.trim()) { setError('Dê um nome ao objeto.'); return; }
    const amount = reward.trim() ? Number(reward.replace(',', '.')) : 0;
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) { setError('Informe uma recompensa entre 0 e 100.000.'); return; }
    saving.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    try {
      const { tag: saved } = await api<{ tag: Tag }>(tag ? `/tags/${tag.id}` : '/tags', token, {
        name: name.trim(), categoryId: category,
        description, publicMessage, rewardAmount: amount, rewardCurrency: currency,
      }, tag ? 'PATCH' : 'POST');
      if (!mounted.current) return;
      // Keep the sheet mounted through its exit animation before opening the QR.
      savedTag.current = saved; closing.current = true; sheet.current?.dismiss();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      if (!savedTag.current) { saving.current = false; if (mounted.current) setBusy(false); }
    }
  }

  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior={busy ? 'none' : 'close'} onPress={() => { closing.current = true; Keyboard.dismiss(); }} accessible={!busy} accessibilityLabel={t("Fechar formulário")} accessibilityHint={t("Fecha o formulário sem salvar.")} />, [busy, t]);
  // Keep the footer mounted while typing; the action always reads current fields.
  const saveAction = useRef(save);
  useLayoutEffect(() => { saveAction.current = save; });
  const footer = useCallback((props: BottomSheetFooterProps) => <BottomSheetFooter {...props}>
    <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
      {!!error && <Notice error text={error} />}
      <Button onPress={() => void saveAction.current()} busy={busy} disabled={categoriesLoading || !category} icon={tag ? 'check' : 'plus'}>{tag ? t("Salvar alterações") : t("Criar etiqueta")}</Button>
    </View>
  </BottomSheetFooter>, [busy, error, insets.bottom, !!tag, styles, categoriesLoading, category, t]);

  // Let Gorhom measure the entire fixed header as its handle, so the scroll
  // viewport and keyboard calculations exclude this space.
  const handle = useCallback((props: BottomSheetHandleProps) => <View>
    <BottomSheetHandle {...props} indicatorStyle={styles.handle} />
    <View style={styles.header}>
      <Text accessibilityRole="header" style={s.h2}>{tag ? t("Editar objeto") : t("Adicionar objeto")}</Text>
    </View>
  </View>, [!!tag, s, styles, t]);

  return <><BottomSheetModal
    ref={sheet}
    name="object-form"
    index={0}
    snapPoints={snapPoints}
    enableDynamicSizing={false}
    enablePanDownToClose={!busy}
    enableHandlePanningGesture={!busy}
    enableContentPanningGesture={!busy}
    enableBlurKeyboardOnGesture={false}
    keyboardBehavior="interactive"
    // Keep the expanded sheet and scroll position when the keyboard closes.
    keyboardBlurBehavior="none"
    android_keyboardInputMode="adjustPan"
    topInset={insets.top + 8}
    backdropComponent={backdrop}
    footerComponent={footer}
    handleComponent={handle}
    backgroundStyle={styles.background}
    handleIndicatorStyle={styles.handle}
    onDismiss={finishDismiss}
    accessibilityLabel={tag ? t("Editar objeto") : t("Adicionar objeto")}
  >
    <KeyboardAwareSheetScrollView
      mode="layout"
      disableScrollOnKeyboardHide
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      bottomOffset={footerHeight + 20}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      enableFooterMarginAdjustment
    >
      <Field inSheet testID="object-name" label={t("Nome do objeto")} placeholder={t("Ex.: Minha mochila verde")} value={name} onChangeText={setName} maxLength={80} editable={!busy} />
      <View style={{ gap: 12 }}><Text style={s.label}>{t("Categoria")}</Text><View style={styles.categories}>{categories.map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={categoryLabel(c, t)} accessibilityState={{ selected: c.id === category, disabled: busy }} disabled={busy} onPress={() => setCategory(c.id)} style={({ pressed }) => [styles.category, { backgroundColor: c.id === category ? C.primary : C.secondary, opacity: pressed || busy ? 0.65 : 1 }]}><Icon name={c.icon as IconName} size={20} color={c.id === category ? C.onPrimary : C.ink} /><Text style={{ color: c.id === category ? C.onPrimary : C.ink, fontSize: 15, fontWeight: '500' }}>{categoryLabel(c, t)}</Text></Pressable>)}</View><Button variant="ghost" icon="edit-2" onPress={() => { Keyboard.dismiss(); setManagingCategories(true); }} disabled={busy}>{t("Gerenciar categorias")}</Button></View>
      <Field inSheet testID="object-note" label={t("Anotação particular (opcional)")} placeholder={t("Modelo, cor ou algum detalhe")} value={description} onChangeText={setDescription} maxLength={500} help={t("Só você vê esta anotação.")} editable={!busy} />
      <Field inSheet testID="object-message" label={t("Mensagem na etiqueta")} multiline scrollEnabled style={{ maxHeight: 160 }} value={publicMessage} onChangeText={setPublicMessage} maxLength={500} help={t("Quem escanear o QR verá esta mensagem. Evite colocar telefone ou endereço.")} editable={!busy} />
      <View style={s.divider} />
      <View style={{ gap: 13 }}>
        <View style={s.row}><Icon name="gift" color={C.accent} /><Text style={[s.h3, { flex: 1 }]}>{t("Recompensa (Opcional)")}</Text></View>
        <Text style={s.small}>{t("Você pode oferecer uma recompensa e combinar o pagamento na conversa. Este valor é uma promessa: nenhum dinheiro é depositado ou transferido pelo app.")}</Text>
        <Field inSheet testID="object-reward" label={t("Valor da recompensa")} value={reward} onChangeText={setReward} keyboardType="decimal-pad" placeholder={(0).toLocaleString(locale, { minimumFractionDigits: 2 })} maxLength={12} editable={!busy} />
        <View style={s.row}>{['BRL', 'USDC', 'SKR'].map(c => <Button key={c} variant={c === currency ? 'primary' : 'secondary'} onPress={() => setCurrency(c)} disabled={busy}>{c === 'BRL' ? 'R$' : c}</Button>)}</View>
      </View>
    </KeyboardAwareSheetScrollView>
  </BottomSheetModal>{managingCategories && <Categories token={token} onClose={() => setManagingCategories(false)} onChanged={next => { applyCategories(next); onCategoriesChanged(); }} />}</>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  background: { backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  handle: { backgroundColor: '#536567', width: 44, height: 5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 26 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  category: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, minHeight: 46, alignItems: 'center', borderRadius: 24 },
  footer: { paddingHorizontal: 20, paddingVertical: 16, gap: 12, backgroundColor: C.popover },
});
