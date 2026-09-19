import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiQueryKey, apiQueryOptions, queryClient } from './query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ActivityIndicator, Alert, Keyboard, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import Pressable from './HapticPressable';
import {
  BottomSheetBackdropProps, BottomSheetFooter, BottomSheetFooterProps,
  BottomSheetHandle, BottomSheetHandleProps, BottomSheetModal,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SheetBackdrop from './SheetBackdrop';
import { api, Category, Tag, User } from './api';
import { Button, Field, Icon, IconName, Notice, useUI } from './ui';
import Categories from './Categories';
import { categoryLabel } from './category.model';
import KeyboardAwareSheetScrollView, { KeyboardAwareSheetScrollViewRef } from './KeyboardAwareSheetScrollView';
import { canonicalRewardAmount, reservationDeadline, reservationSeconds, rewardInput, rewardLocked, rewardAwaitingConfirmation } from './reward.model';
import type { ReservationUnit } from './reward.model';
import { amountToUnits, MAX_REWARD_SECONDS, REWARD_DECIMALS } from '@seekertag/shared/reward';
import type { RewardAction, RewardCurrency } from '@seekertag/shared/reward';
import { useReward } from './useReward';
import RewardFields, { RewardPeriod } from './RewardFields';
import RewardReview, { reviewTitle } from './RewardReview';
import RewardEditorSheet from './RewardEditorSheet';
import RewardSummary, { RewardPendingNotice, RewardNetworkBadge } from './RewardSummary';
import AccountActionSheet from './AccountActionSheet';
import { tagFormSchema, type TagFormValues } from './form.model';
import { NavigationScope, useNavigationLayer } from './Navigation';
import { authenticate } from './platform/auth';

export default function TagForm({ token, user, onUserUpdated, tag, onClose, onSaved, onCategoriesChanged, rewardOnly = false }: { token: string; user: User; onUserUpdated: (user: User) => void; tag?: Tag; rewardOnly?: boolean; onClose: () => void; onSaved: (tag: Tag) => void; onCategoriesChanged?: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const sheet = useRef<BottomSheetModal>(null);
  const formScroll = useRef<KeyboardAwareSheetScrollViewRef>(null);
  const rewardSheet = useRef<BottomSheetModal>(null);
  const [rewardOpen, setRewardOpen] = useState(rewardOnly);
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ['78%', '96%'], []);
  const saving = useRef(false);
  const closing = useRef(false);
  const mounted = useRef(false);
  const savedTag = useRef<Tag | null>(null);
  const { control, handleSubmit, watch, reset, formState: { errors, isDirty } } = useForm<TagFormValues>({
    resolver: zodResolver(tagFormSchema), mode: 'onChange',
    defaultValues: { name: tag?.name || '', description: tag?.description || '', publicMessage: tag?.publicMessage || t("Obrigado por cuidar do que é importante para mim. Me envie uma mensagem para combinarmos a devolução.") },
  });
  const name = watch('name');
  const categoriesQuery = useQuery({ ...apiQueryOptions<{ categories: Category[] }>('/categories', token), enabled: !rewardOnly });
  const categories = categoriesQuery.data?.categories ?? [];
  const [category, setCategory] = useState(tag?.categoryId || '');
  const categoriesLoading = !rewardOnly && categoriesQuery.isPending;
  const categoriesError = categoriesQuery.error?.message || '';
  const [managingCategories, setManagingCategories] = useState(false);
  const initialCategory = useRef(tag?.categoryId);
  const guard = useRef({ dirty: false, t });
  const lastSheetIndex = useRef(0);
  const [currentTagId, setCurrentTagId] = useState(tag?.id);
  const tagQuery = useQuery({
    ...apiQueryOptions<{ tag: Tag }>(`/tags/${currentTagId}`, token),
    enabled: !!currentTagId,
    initialData: tag && tag.id === currentTagId ? { tag } : undefined,
  });
  const currentTag = tagQuery.data?.tag;
  const setCurrentTag = (next: Tag) => {
    queryClient.setQueryData(apiQueryKey(token, `/tags/${next.id}`), { tag: next });
    setCurrentTagId(next.id);
  };
  const currentTagRef = useRef(currentTag); currentTagRef.current = currentTag;
  const supported = !tag?.rewardCurrency || ['SOL', 'USDC', 'SKR'].includes(tag.rewardCurrency);
  const [reward, setReward] = useState(supported && tag?.rewardAmount ? rewardInput(String(tag.rewardAmount), locale) : '');
  const [currency, setCurrency] = useState<RewardCurrency>(supported ? (tag?.rewardCurrency as RewardCurrency || 'SKR') : 'SKR');
  const initialReward = useRef({ reward, currency, quantity: '30', unit: 'days' });
  const [legacyReward, setLegacyReward] = useState(!supported && !!tag?.rewardAmount);
  const [quantity, setQuantity] = useState('30');
  const [unit, setUnit] = useState<ReservationUnit>('days');
  const [renewing, setRenewing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [refundConfirm, setRefundConfirm] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const wallet = useReward({ token, tagId: currentTag?.id, currency,
    onChanged: next => {
      const previous = currentTagRef.current;
      if (!previous) return;
      const updated = { ...previous, reward: next, ...(next ? { rewardAmount: Number(next.amount), rewardCurrency: next.currency } : {}) };
      savedTag.current = updated;
      currentTagRef.current = updated; setCurrentTag(updated);
    },
    onCompleted: () => { Keyboard.dismiss(); closing.current = true; rewardSheet.current?.dismiss(); sheet.current?.dismiss(); },
  });
  const busy = savedBusy || wallet.busy;
  const busyRef = useRef(busy); busyRef.current = busy;
  const activeReward = wallet.data ? wallet.data.reward : currentTag?.reward;
  const waiting = wallet.operation?.status === 'submitted' || rewardAwaitingConfirmation(activeReward);
  const editingDisabled = busy || waiting || wallet.loading;
  const categoriesDisabled = busy || waiting;
  const lockedReward = rewardLocked(activeReward) || !!wallet.operation;
  const period = reservationSeconds(quantity, unit);
  const durationValid = !!period && (!renewing || reservationDeadline(period, activeReward?.refundAfter).getTime() <= Date.now() + MAX_REWARD_SECONDS * 1000);
  const wantsReward = Number(canonicalRewardAmount(reward)) > 0;
  let amountValid = !reward || Number(canonicalRewardAmount(reward)) === 0;
  try { amountValid = wallet.balance?.currency === currency && amountToUnits(canonicalRewardAmount(reward), REWARD_DECIMALS[currency]) <= BigInt(wallet.balance.fundableUnits ?? wallet.balance.availableUnits); } catch {}
  const canReserve = !!wallet.data?.payer && !!wallet.data.config && amountValid && durationValid;
  const needsWallet = !user.walletAddress && !lockedReward;
  const operationId = wallet.operation?.operation.id;
  useEffect(() => {
    if (operationId) { Keyboard.dismiss(); setReviewing(true); setRewardOpen(true); }
    else if (!wallet.loading) setReviewing(false);
  }, [operationId, wallet.loading]);
  useEffect(() => {
    if (rewardOpen && needsWallet) ToastAndroid.show(t('Conecte sua carteira para adicionar uma recompensa'), ToastAndroid.LONG);
  }, [rewardOpen, needsWallet, t]);
  const [error, setError] = useState('');
  const [footerHeight, setFooterHeight] = useState(90 + insets.bottom);
  useEffect(() => {
    if (!categoriesQuery.data) return;
    const next = categoriesQuery.data.categories;
    setCategory(current => {
      const untouched = initialCategory.current === undefined || current === initialCategory.current;
      const serverCategory = next.find(item => item.id === currentTag?.categoryId)?.id;
      const selected = untouched && serverCategory ? serverCategory : next.some(item => item.id === current) ? current : serverCategory || next[0]?.id || '';
      // A category replacement on the server updates an untouched selection;
      // it never resets item text or a still-valid category draft.
      if (untouched) initialCategory.current = selected;
      return selected;
    });
  }, [categoriesQuery.data, currentTag?.categoryId]);
  const saveMutation = useMutation({
    mutationFn: ({ values, amount }: { values: TagFormValues; amount: number }) => api<{ tag: Tag }>(currentTag ? `/tags/${currentTag.id}` : '/tags', token, {
      name: values.name, categoryId: category,
      description: values.description, publicMessage: values.publicMessage,
      ...(!lockedReward && !legacyReward ? { rewardAmount: amount, rewardCurrency: currency } : {}),
    }, currentTag ? 'PATCH' : 'POST'),
    retry: false,
  });

  const dirty = isDirty || (initialCategory.current !== undefined && category !== initialCategory.current) || reward !== initialReward.current.reward || currency !== initialReward.current.currency || quantity !== initialReward.current.quantity || unit !== initialReward.current.unit;
  guard.current = { dirty, t };
  const close = useCallback(() => {
    if (saving.current || busyRef.current || closing.current) return;
    const dismiss = () => { closing.current = true; Keyboard.dismiss(); (rewardOnly ? rewardSheet : sheet).current?.dismiss(); };
    if (guard.current.dirty) Alert.alert(guard.current.t('Descartar alterações?'), guard.current.t('As alterações não salvas serão perdidas.'), [
      { text: guard.current.t('Continuar editando'), style: 'cancel' },
      { text: guard.current.t('Descartar'), style: 'destructive', onPress: dismiss },
    ]); else dismiss();
  }, [rewardOnly]);
  const layer = useNavigationLayer(close, true, !rewardOnly);
  useEffect(() => {
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    return () => { mounted.current = false; modal?.dismiss(); };
  }, []);

  function finishDismiss() {
    if (!mounted.current) return;
    Keyboard.dismiss();
    if (savedTag.current) onSaved(currentTagRef.current ?? savedTag.current);
    else onClose();
  }

  async function submit(values: TagFormValues, action?: RewardAction) {
    if (saving.current || busyRef.current || closing.current || waiting || wallet.loading) return;
    if (categoriesLoading || !category) { setError('Escolha uma categoria.'); return; }
    const amount = reward.trim() ? Number(canonicalRewardAmount(reward)) : 0;
    if (!lockedReward && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)) { setError('Valor de recompensa inválido.'); return; }
    const kind = action || (renewing ? 'renew' : !lockedReward && wantsReward ? 'fund' : undefined);
    if (kind === 'fund' && !canReserve || kind === 'renew' && !durationValid) return;
    saving.current = true; setSavedBusy(true); setError(''); Keyboard.dismiss();
    try {
      const { tag: saved } = await saveMutation.mutateAsync({ values, amount });
      if (!mounted.current) return;
      // Creation is durable before preparing a deposit. A retry edits this same
      // tag, so backing out of wallet review never creates a duplicate object.
      savedTag.current = saved; currentTagRef.current = saved; setCurrentTag(saved);
      reset(values); initialCategory.current = category; initialReward.current = { reward, currency, quantity, unit };
      if (kind) {
        const ready = await wallet.review(kind, { amount: canonicalRewardAmount(reward), currency, durationSeconds: period || undefined }, saved.id);
        if (ready && mounted.current) { setRefundConfirm(false); setReviewing(true); setRewardOpen(true); }
      } else { closing.current = true; sheet.current?.dismiss(); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      saving.current = false; if (mounted.current) setSavedBusy(false);
    }
  }

  async function reviewReward(action?: RewardAction) {
    if (saving.current || busyRef.current || closing.current || waiting || wallet.loading || !currentTag) return;
    const kind = action || (renewing ? 'renew' : 'fund');
    if (kind === 'fund' && (!wantsReward || !canReserve) || kind === 'renew' && !durationValid) return;
    saving.current = true;
    try {
      // This entry edits only the reward; item fields and categories stay untouched.
      const ready = await wallet.review(kind, { amount: canonicalRewardAmount(reward), currency, durationSeconds: period || undefined });
      if (ready && mounted.current) {
        initialReward.current = { reward, currency, quantity, unit };
        setRefundConfirm(false); setReviewing(true);
      }
    } finally { saving.current = false; }
  }

  function save(action?: RewardAction) {
    if (rewardOnly) void reviewReward(action);
    else void handleSubmit(values => submit(values, action))();
  }

  async function connectWallet() {
    if (connectingWallet) return;
    setConnectingWallet(true); setError('');
    try {
      const result = await authenticate('solana', 'link', token, locale.slice(0, 2));
      if (result?.user) onUserUpdated(result.user);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível conectar sua carteira.');
    } finally { if (mounted.current) setConnectingWallet(false); }
  }

  const backdrop = useCallback((props: BottomSheetBackdropProps) => <SheetBackdrop {...props} onPress={close} disabled={busy} label={t('Fechar formulário')} />, [busy, close, t]);
  // Keep the footer mounted while typing; the action always reads current fields.
  const saveDisabled = waiting || (!rewardOnly && (categoriesLoading || !category || !name.trim() || !!errors.name)) || wallet.loading || (!lockedReward && !!reward && (!amountValid || wantsReward && !canReserve)) || renewing && !durationValid;
  const footerError = error || wallet.error;
  const actionLabel = renewing ? t('Salvar e revisar renovação') : !lockedReward && wantsReward ? t('Salvar e revisar depósito') : currentTag ? t('Salvar alterações') : t('Criar etiqueta');
  const walletAction = useRef(wallet); walletAction.current = wallet;
  const reviewPrepared = ['prepared', 'expired'].includes(wallet.operation?.status || '');
  const reviewKind = wallet.operation?.operation.spec.kind;
  const saveAction = useRef(save);
  useLayoutEffect(() => { saveAction.current = save; });
  const footer = useCallback((props: BottomSheetFooterProps) => <BottomSheetFooter {...props}>
    <View accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'} onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
      {!!footerError && <Notice error text={footerError} />}
      <Button onPress={() => void saveAction.current()} busy={busy} disabled={saveDisabled} icon={currentTag ? 'check' : 'plus'}>{actionLabel}</Button>
    </View>
  </BottomSheetFooter>, [busy, footerError, insets.bottom, !!currentTag, styles, saveDisabled, actionLabel, reviewing, operationId, reviewPrepared, reviewKind, t, layer.active]);

  // Let Gorhom measure the entire fixed header as its handle, so the scroll
  // viewport and keyboard calculations exclude this space.
  const handle = useCallback((props: BottomSheetHandleProps) => <View>
    <BottomSheetHandle {...props} indicatorStyle={styles.handle} />
    <View style={styles.header} pointerEvents={layer.active ? 'auto' : 'none'} accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'}>
      <Text accessibilityRole="header" style={[s.h2, { flex: 1 }]}>{currentTag ? t("Editar objeto") : t("Adicionar objeto")}</Text><Button variant="ghost" icon="x" label={t("Fechar formulário")} disabled={busy} onPress={close} />
    </View>
  </View>, [!!currentTag, s, styles, t, reviewing, operationId, busy, waiting, close, layer.active]);

  return <NavigationScope path={layer.path}>{!rewardOnly && <BottomSheetModal stackBehavior="push"
    ref={sheet}
    name="object-form"
    index={lastSheetIndex.current}
    onChange={index => { if (index >= 0) lastSheetIndex.current = index; }}
    snapPoints={snapPoints}
    enableDynamicSizing={false}
    enablePanDownToClose={!busy && !dirty}
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
    <NavigationScope path={layer.path}><KeyboardAwareSheetScrollView
      ref={formScroll}
      accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'}
      key="form"
      mode="layout"
      disableScrollOnKeyboardHide
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      bottomOffset={footerHeight + 20}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      enableFooterMarginAdjustment
    >
      {waiting && !rewardOpen && <RewardPendingNotice />}
      <Controller control={control} name="name" render={({ field }) => <Field inSheet testID="object-name" label={t("Nome do objeto")} placeholder={t("Ex.: Minha mochila verde")} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.name?.message} maxLength={80} editable={!editingDisabled} />} />
      <View style={{ gap: 12 }}>
        <Text style={s.label}>{t("Categoria")}</Text>
        {categoriesLoading && <View style={s.row} accessibilityLiveRegion="polite"><ActivityIndicator color={C.accent} /><Text style={s.small}>{t('Carregando categorias…')}</Text></View>}
        <View style={styles.categories}>{categories.map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={categoryLabel(c, t)} accessibilityState={{ selected: c.id === category, disabled: categoriesDisabled }} disabled={categoriesDisabled} onPress={() => setCategory(c.id)} style={({ pressed }) => [styles.category, { backgroundColor: c.id === category ? C.primary : C.secondary, opacity: pressed || categoriesDisabled ? 0.65 : 1 }]}><Icon name={c.icon as IconName} size={20} color={c.id === category ? C.onPrimary : C.ink} /><Text style={{ color: c.id === category ? C.onPrimary : C.ink, fontSize: 15, fontWeight: '500' }}>{categoryLabel(c, t)}</Text></Pressable>)}</View>
        {!!categoriesError && <><Notice error text={categoriesError} /><Button variant="secondary" disabled={categoriesLoading || categoriesDisabled} onPress={() => void categoriesQuery.refetch()}>{t('Tentar novamente')}</Button></>}
        {!categoriesLoading && !categoriesError && !categories.length && <Text style={s.small}>{t('Crie sua primeira categoria.')}</Text>}
        <Button variant="ghost" icon="edit-2" onPress={() => { Keyboard.dismiss(); setManagingCategories(true); }} disabled={categoriesDisabled}>{t("Gerenciar categorias")}</Button>
      </View>
      <Controller control={control} name="description" render={({ field }) => <Field inSheet testID="object-note" label={t("Anotação particular (opcional)")} placeholder={t("Modelo, cor ou algum detalhe")} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.description?.message} maxLength={500} tooltip={t("Só você vê esta anotação.")} editable={!editingDisabled} />} />
      <Controller control={control} name="publicMessage" render={({ field }) => <Field inSheet testID="object-message" label={t("Mensagem na etiqueta")} multiline scrollEnabled style={{ maxHeight: 160 }} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.publicMessage?.message} maxLength={500} help={t("Quem escanear o QR verá esta mensagem.")} tooltip={t("Recomendação: evite colocar telefone ou endereço.")} editable={!editingDisabled} />} />
      <Pressable accessibilityRole="button" accessibilityLabel={t(needsWallet ? 'Conecte sua carteira para adicionar uma recompensa' : 'Recompensa (Opcional)')} accessibilityState={{ disabled: busy || wallet.loading || connectingWallet }} disabled={busy || wallet.loading || connectingWallet}
        onPress={() => { Keyboard.dismiss(); if (needsWallet) void connectWallet(); else setRewardOpen(true); }} style={({ pressed }) => [s.card, s.between, { opacity: pressed ? 0.65 : 1 }]}>
        {activeReward ? <RewardSummary reward={activeReward} /> : <View style={[s.row, { flex: 1 }]}>
          <View style={s.settingsIcon}><Icon name={needsWallet ? 'credit-card' : 'gift'} size={20} color={needsWallet ? C.accent : undefined} /></View>
          <View style={{ flex: 1, gap: 5 }}><Text style={s.h3}>{t(needsWallet ? 'Conecte sua carteira para adicionar uma recompensa' : 'Recompensa (Opcional)')}</Text>
            <Text style={s.small}>{needsWallet ? t('A recompensa fica reservada na sua carteira Solana até a devolução do objeto.') : legacyReward ? `${currentTag?.rewardAmount} ${currentTag?.rewardCurrency}` : wantsReward ? `${reward} ${currency}` : t('Adicionar recompensa')}</Text></View>
        </View>}
        {connectingWallet ? <Icon name="loader" size={20} color={C.muted} /> : <Icon name={waiting ? 'clock' : 'chevron-right'} size={20} color={C.muted} />}
      </Pressable>
    </KeyboardAwareSheetScrollView></NavigationScope>
  </BottomSheetModal>}
    {rewardOpen && <RewardEditorSheet ref={rewardSheet} busy={busy}
      onRequestClose={rewardOnly ? close : undefined} preventDismiss={rewardOnly && dirty}
      titleAccessory={reviewing && wallet.data?.config && wallet.data.config.network !== 'mainnet' ? <RewardNetworkBadge network={wallet.data.config.network} /> : undefined}
      title={renewing && !reviewing ? t('Renovar reserva') : waiting ? t('Recompensa') : reviewing && wallet.operation ? reviewTitle(wallet.operation.operation.spec.kind, t) : t('Recompensa')}
      contentKey={reviewing && operationId ? 'review' : 'reward'}
      onClose={() => {
        if (rewardOnly) { finishDismiss(); return; }
        setRewardOpen(false);
        // A dismissed invalid draft should not surprise the user on the next open.
        // Keep valid drafts so closing the sheet remains reversible.
        if (!lockedReward && !reviewing && !wallet.loading && !wallet.balanceLoading && wantsReward && (!amountValid || !durationValid)) {
          setReward(''); setQuantity('30'); setUnit('days'); setCurrency('SOL');
        }
        if (closing.current) sheet.current?.dismiss();
      }}
      onBack={!busy && !waiting ? renewing && !reviewing ? () => setRenewing(false) : reviewing && reviewPrepared ? () => { wallet.discardReview(); setReviewing(false); } : undefined : undefined}
      footer={<>
        {!!footerError && <Notice error text={footerError} />}
        {reviewing && operationId ? <Button variant={reviewPrepared ? reviewKind === 'refund' ? 'warning' : 'success' : 'secondary'} icon={reviewPrepared ? 'check' : 'refresh-cw'} busy={busy} disabled={reviewPrepared && reviewKind === 'release'} onPress={() => { if (reviewPrepared) void walletAction.current.approve(); else void walletAction.current.retry(); }}>{reviewPrepared ? t('Assinar na carteira') : t('Verificar transação')}</Button>
          : renewing ? <Button onPress={() => void save('renew')} busy={busy} disabled={saveDisabled}>{t(rewardOnly ? 'Revisar renovação' : 'Salvar e revisar renovação')}</Button>
          : rewardOnly && !lockedReward && !legacyReward && wantsReward ? <Button onPress={() => save('fund')} busy={busy} disabled={saveDisabled}>{t('Revisar depósito')}</Button>
          : !rewardOnly && (lockedReward ? activeReward?.status !== 'expired' : legacyReward || wantsReward) && <Button icon="check" disabled={busy || !lockedReward && wantsReward && !canReserve} onPress={() => { Keyboard.dismiss(); rewardSheet.current?.dismiss(); }}>{t('Concluir')}</Button>}
      </>}> 
      {reviewing && wallet.operation ? <RewardReview controller={wallet} /> : <>
        {renewing ? <RewardPeriod quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} disabled={editingDisabled} refundAfter={activeReward?.refundAfter} /> : lockedReward ? <>
          <View style={s.card}><RewardSummary reward={activeReward} amount={currentTag?.rewardAmount} currency={currentTag?.rewardCurrency} loading={wallet.loading} /></View>
          {wallet.operation ? <Button variant="accent" icon="shield" onPress={() => { Keyboard.dismiss(); setReviewing(true); }}>{t('Retomar revisão')}</Button> : <>
            {!renewing && activeReward?.refundAfter && <Text style={s.small}>{t('Cancelamento a partir de {date}', { date: new Date(activeReward.refundAfter).toLocaleString(locale) })}</Text>}
            {activeReward?.status === 'expired' && <>
              <Button variant="accent" icon="refresh-cw" disabled={editingDisabled} onPress={() => { setRenewing(true); }}>{t('Renovar reserva')}</Button>
              {!renewing && <Button variant="warning" icon="corner-up-left" busy={busy} disabled={editingDisabled || !activeReward?.refundAfter || Date.parse(activeReward.refundAfter) > Date.now()} onPress={() => setRefundConfirm(true)}>{t('Cancelar e recuperar')}</Button>}
            </>}
            {activeReward?.status === 'unverified' && <Notice tone="warning" text={t('Não foi possível confirmar a reserva agora. Aguarde a conexão com a rede antes de continuar.')} />}
          </>}
        </> : legacyReward ? <>
          <View style={s.card}><RewardSummary amount={currentTag?.rewardAmount} currency={currentTag?.rewardCurrency} /></View>
          <Button variant="secondary" disabled={editingDisabled} onPress={() => setLegacyReward(false)}>{t('Usar recompensa em cripto')}</Button>
        </> : needsWallet ? <View style={styles.walletNotice}>
          <View style={s.row}><View style={s.settingsIcon}><Icon name="credit-card" color={C.accent} size={22} /></View><Text style={[s.h3, { flex: 1 }]}>{t('Conecte sua carteira para adicionar uma recompensa')}</Text></View>
          <Text style={s.body}>{t('A recompensa fica reservada na sua carteira Solana até a devolução do objeto.')}</Text>
          <Button variant="ghost" icon="credit-card" busy={connectingWallet} onPress={() => void connectWallet()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}>{t('Vincular Seeker / Solana')}</Button>
        </View> : <>
          <RewardFields controller={wallet} value={reward} currency={currency} onValue={setReward} onCurrency={setCurrency} disabled={editingDisabled} />
          {wantsReward && <>
            <RewardPeriod quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} disabled={editingDisabled} />
            {wallet.data && !wallet.data.config && <Notice text={t('Os depósitos de recompensa ainda não estão disponíveis.')} />}
            {wallet.data?.config && !wallet.data.payer && <Notice text={t('Vincule sua carteira Solana em Minha conta para financiar uma recompensa.')} />}
          </>}
        </>}
      </>}
    </RewardEditorSheet>}
    {managingCategories && <Categories presentation="sheet" token={token} onClose={() => setManagingCategories(false)} onChanged={() => onCategoriesChanged?.()} />}
    {refundConfirm && <AccountActionSheet busy={busy} onClose={() => { if (!busy) setRefundConfirm(false); }}>
      <View style={{ gap: 20 }}>
        <View style={{ alignItems: 'center', gap: 14 }}><View style={[s.settingsIcon, { backgroundColor: C.amberSoft }]}><Icon name="corner-up-left" color={C.amber} size={24} /></View><Text style={[s.h2, { textAlign: 'center' }]}>{t('Cancelar e recuperar?')}</Text><Text style={[s.body, { textAlign: 'center', color: C.muted }]}>{t('Confirme somente se o prazo da reserva terminou. O depósito será devolvido à carteira que financiou a recompensa.')}</Text></View>
        <Button variant="warning" icon="corner-up-left" busy={busy} disabled={busy || editingDisabled} onPress={() => { void save('refund'); }}>{t('Confirmar recuperação')}</Button>
        <Button variant="ghost" disabled={busy} onPress={() => setRefundConfirm(false)}>{t('Cancelar')}</Button>
      </View>
    </AccountActionSheet>}
  </NavigationScope>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  background: { backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  handle: { backgroundColor: '#536567', width: 44, height: 5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 26 },
  walletNotice: { gap: 12 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  category: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, minHeight: 46, alignItems: 'center', borderRadius: 24 },
  footer: { paddingHorizontal: 20, paddingVertical: 16, gap: 12, backgroundColor: C.popover },
});
