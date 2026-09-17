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
import KeyboardAwareSheetScrollView, { KeyboardAwareSheetScrollViewRef } from './KeyboardAwareSheetScrollView';
import { canonicalRewardAmount, reservationDeadline, reservationSeconds, rewardInput, rewardLocked, rewardAwaitingConfirmation } from './reward.model';
import type { ReservationUnit } from './reward.model';
import { amountToUnits, MAX_REWARD_SECONDS, REWARD_DECIMALS } from '../shared/reward';
import type { RewardAction, RewardCurrency } from '../shared/reward';
import { useReward } from './useReward';
import RewardFields, { RewardPeriod } from './RewardFields';
import RewardReview, { reviewTitle } from './RewardReview';
import RewardEditorSheet from './RewardEditorSheet';
import RewardSummary, { RewardPendingNotice, RewardNetworkBadge } from './RewardSummary';

export default function TagForm({ token, tag, onClose, onSaved, onCategoriesChanged, focusReward = false }: { token: string; tag?: Tag; focusReward?: boolean; onClose: () => void; onSaved: (tag: Tag) => void; onCategoriesChanged: () => void }) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const sheet = useRef<BottomSheetModal>(null);
  const formScroll = useRef<KeyboardAwareSheetScrollViewRef>(null);
  const focusedReward = useRef(false);
  const rewardSheet = useRef<BottomSheetModal>(null);
  const [rewardOpen, setRewardOpen] = useState(false);
  const rewardOpenRef = useRef(rewardOpen); rewardOpenRef.current = rewardOpen;
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
  const categoryScreenOpen = useRef(false);
  const lastSheetIndex = useRef(0);
  const [sheetIndex, setSheetIndex] = useState(-1);
  const [description, setDescription] = useState(tag?.description || '');
  const [publicMessage, setPublicMessage] = useState(tag?.publicMessage || t("Obrigado por cuidar do que é importante para mim. Me envie uma mensagem para combinarmos a devolução."));
  const [currentTag, setCurrentTag] = useState(tag);
  const currentTagRef = useRef(currentTag); currentTagRef.current = currentTag;
  const supported = !tag?.rewardCurrency || ['SOL', 'USDC', 'SKR'].includes(tag.rewardCurrency);
  const [reward, setReward] = useState(supported && tag?.rewardAmount ? rewardInput(String(tag.rewardAmount), locale) : '');
  const [currency, setCurrency] = useState<RewardCurrency>(supported ? (tag?.rewardCurrency as RewardCurrency || 'SOL') : 'SOL');
  const [legacyReward, setLegacyReward] = useState(!supported && !!tag?.rewardAmount);
  const [quantity, setQuantity] = useState('30');
  const [unit, setUnit] = useState<ReservationUnit>('days');
  const [renewing, setRenewing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
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
  const lockedReward = rewardLocked(activeReward) || !!wallet.operation;
  const period = reservationSeconds(quantity, unit);
  const durationValid = !!period && (!renewing || reservationDeadline(period, activeReward?.refundAfter).getTime() <= Date.now() + MAX_REWARD_SECONDS * 1000);
  const wantsReward = Number(canonicalRewardAmount(reward)) > 0;
  let amountValid = !reward || Number(canonicalRewardAmount(reward)) === 0;
  try { amountValid = wallet.balance?.currency === currency && amountToUnits(canonicalRewardAmount(reward), REWARD_DECIMALS[currency]) <= BigInt(wallet.balance.fundableUnits ?? wallet.balance.availableUnits); } catch {}
  const canReserve = !!wallet.data?.payer && !!wallet.data.config && amountValid && durationValid;
  const operationId = wallet.operation?.operation.id;
  useEffect(() => {
    if (operationId) { Keyboard.dismiss(); setReviewing(true); setRewardOpen(true); }
    else if (!wallet.loading) setReviewing(false);
  }, [operationId, wallet.loading]);
  useEffect(() => {
    if (!focusReward || focusedReward.current || sheetIndex < 0 || wallet.loading) return;
    focusedReward.current = true; setRewardOpen(true);
  }, [focusReward, sheetIndex, wallet.loading]);
  const [error, setError] = useState('');
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
    if (saving.current || busyRef.current || closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    sheet.current?.dismiss();
  }, []);

  useEffect(() => {
    if (managingCategories) return;
    categoryScreenOpen.current = false;
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else if (rewardOpenRef.current) { if (!busyRef.current) rewardSheet.current?.dismiss(); }
      else close();
      return true;
    });
    return () => { mounted.current = false; back.remove(); modal?.dismiss(); };
  }, [close, managingCategories]);

  function finishDismiss() {
    if (!mounted.current || categoryScreenOpen.current) return;
    Keyboard.dismiss();
    if (savedTag.current) onSaved(savedTag.current);
    else onClose();
  }

  async function save(action?: RewardAction) {
    if (saving.current || busyRef.current || closing.current || waiting || wallet.loading) return;
    if (categoriesLoading || !category) { setError('Escolha uma categoria.'); return; }
    if (!name.trim()) { setError('Dê um nome ao objeto.'); return; }
    const amount = reward.trim() ? Number(canonicalRewardAmount(reward)) : 0;
    if (!lockedReward && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)) { setError('Valor de recompensa inválido.'); return; }
    const kind = action || (renewing ? 'renew' : !lockedReward && wantsReward ? 'fund' : undefined);
    if (kind === 'fund' && !canReserve || kind === 'renew' && !durationValid) return;
    saving.current = true; setSavedBusy(true); setError(''); Keyboard.dismiss();
    try {
      const { tag: saved } = await api<{ tag: Tag }>(currentTag ? `/tags/${currentTag.id}` : '/tags', token, {
        name: name.trim(), categoryId: category,
        description, publicMessage, ...(!lockedReward && !legacyReward ? { rewardAmount: amount, rewardCurrency: currency } : {}),
      }, currentTag ? 'PATCH' : 'POST');
      if (!mounted.current) return;
      // Creation is durable before preparing a deposit. A retry edits this same
      // tag, so backing out of wallet review never creates a duplicate object.
      savedTag.current = saved; currentTagRef.current = saved; setCurrentTag(saved);
      if (kind) {
        const ready = await wallet.review(kind, { amount: canonicalRewardAmount(reward), currency, durationSeconds: period || undefined }, saved.id);
        if (ready && mounted.current) { setReviewing(true); setRewardOpen(true); }
      } else { closing.current = true; sheet.current?.dismiss(); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      saving.current = false; if (mounted.current) setSavedBusy(false);
    }
  }

  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior={busy ? 'none' : 'close'} onPress={() => { closing.current = true; Keyboard.dismiss(); }} accessible={!busy} accessibilityLabel={t("Fechar formulário")} accessibilityHint={t("Fecha o formulário sem salvar.")} />, [busy, t]);
  // Keep the footer mounted while typing; the action always reads current fields.
  const saveDisabled = waiting || categoriesLoading || !category || !name.trim() || wallet.loading || (!lockedReward && !!reward && (!amountValid || wantsReward && !canReserve)) || renewing && !durationValid;
  const footerError = error || wallet.error;
  const actionLabel = renewing ? t('Salvar e revisar renovação') : !lockedReward && wantsReward ? t('Salvar e revisar depósito') : currentTag ? t('Salvar alterações') : t('Criar etiqueta');
  const walletAction = useRef(wallet); walletAction.current = wallet;
  const reviewPrepared = ['prepared', 'expired'].includes(wallet.operation?.status || '');
  const reviewKind = wallet.operation?.operation.spec.kind;
  const saveAction = useRef(save);
  useLayoutEffect(() => { saveAction.current = save; });
  const footer = useCallback((props: BottomSheetFooterProps) => <BottomSheetFooter {...props}>
    <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
      {!!footerError && <Notice error text={footerError} />}
      <Button onPress={() => void saveAction.current()} busy={busy} disabled={saveDisabled} icon={currentTag ? 'check' : 'plus'}>{actionLabel}</Button>
    </View>
  </BottomSheetFooter>, [busy, footerError, insets.bottom, !!currentTag, styles, saveDisabled, actionLabel, reviewing, operationId, reviewPrepared, reviewKind, t]);

  // Let Gorhom measure the entire fixed header as its handle, so the scroll
  // viewport and keyboard calculations exclude this space.
  const handle = useCallback((props: BottomSheetHandleProps) => <View>
    <BottomSheetHandle {...props} indicatorStyle={styles.handle} />
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[s.h2, { flex: 1 }]}>{currentTag ? t("Editar objeto") : t("Adicionar objeto")}</Text>
    </View>
  </View>, [!!currentTag, s, styles, t, reviewing, operationId, busy, waiting]);

  // Keep the draft in this component while presenting only one keyboard surface.
  // An Android Modal over an interactive sheet can change its hidden keyboard offset.
  if (managingCategories) return <Categories token={token} onClose={() => setManagingCategories(false)} onChanged={next => { applyCategories(next); onCategoriesChanged(); }} />;

  return <><BottomSheetModal
    ref={sheet}
    name="object-form"
    index={lastSheetIndex.current}
    onChange={index => { setSheetIndex(index); if (index >= 0) lastSheetIndex.current = index; }}
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
      ref={formScroll}
      key="form"
      mode="layout"
      disableScrollOnKeyboardHide
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      bottomOffset={footerHeight + 20}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      enableFooterMarginAdjustment
    >
      {waiting && <RewardPendingNotice />}
      <Field inSheet testID="object-name" label={t("Nome do objeto")} placeholder={t("Ex.: Minha mochila verde")} value={name} onChangeText={setName} maxLength={80} editable={!editingDisabled} />
      <View style={{ gap: 12 }}><Text style={s.label}>{t("Categoria")}</Text><View style={styles.categories}>{categories.map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={categoryLabel(c, t)} accessibilityState={{ selected: c.id === category, disabled: editingDisabled }} disabled={editingDisabled} onPress={() => setCategory(c.id)} style={({ pressed }) => [styles.category, { backgroundColor: c.id === category ? C.primary : C.secondary, opacity: pressed || editingDisabled ? 0.65 : 1 }]}><Icon name={c.icon as IconName} size={20} color={c.id === category ? C.onPrimary : C.ink} /><Text style={{ color: c.id === category ? C.onPrimary : C.ink, fontSize: 15, fontWeight: '500' }}>{categoryLabel(c, t)}</Text></Pressable>)}</View><Button variant="ghost" icon="edit-2" onPress={() => { categoryScreenOpen.current = true; Keyboard.dismiss(); setManagingCategories(true); }} disabled={editingDisabled}>{t("Gerenciar categorias")}</Button></View>
      <Field inSheet testID="object-note" label={t("Anotação particular (opcional)")} placeholder={t("Modelo, cor ou algum detalhe")} value={description} onChangeText={setDescription} maxLength={500} help={t("Só você vê esta anotação.")} editable={!editingDisabled} />
      <Field inSheet testID="object-message" label={t("Mensagem na etiqueta")} multiline scrollEnabled style={{ maxHeight: 160 }} value={publicMessage} onChangeText={setPublicMessage} maxLength={500} help={t("Quem escanear o QR verá esta mensagem. Evite colocar telefone ou endereço.")} editable={!editingDisabled} />
      <Pressable accessibilityRole="button" accessibilityLabel={t('Recompensa (Opcional)')} accessibilityState={{ disabled: busy || wallet.loading }} disabled={busy || wallet.loading}
        onPress={() => { Keyboard.dismiss(); setRewardOpen(true); }} style={({ pressed }) => [s.card, s.between, { opacity: pressed ? 0.65 : 1 }]}>
        {activeReward ? <RewardSummary reward={activeReward} /> : <View style={[s.row, { flex: 1 }]}>
          <View style={s.settingsIcon}><Icon name="gift" size={20} /></View>
          <View style={{ flex: 1, gap: 5 }}><Text style={s.h3}>{t('Recompensa (Opcional)')}</Text>
            <Text style={s.small}>{legacyReward ? `${currentTag?.rewardAmount} ${currentTag?.rewardCurrency}` : wantsReward ? `${reward} ${currency}` : t('Adicionar recompensa')}</Text></View>
        </View>}
        <Icon name={waiting ? 'clock' : 'chevron-right'} size={20} color={C.muted} />
      </Pressable>
    </KeyboardAwareSheetScrollView>
  </BottomSheetModal>
    {rewardOpen && <RewardEditorSheet ref={rewardSheet} busy={busy}
      titleAccessory={wallet.data?.config && wallet.data.config.network !== 'mainnet' ? <RewardNetworkBadge network={wallet.data.config.network} /> : undefined}
      title={waiting ? t('Confirmando na rede') : reviewing && wallet.operation ? reviewTitle(wallet.operation.operation.spec.kind, t) : t('Recompensa')}
      contentKey={reviewing && operationId ? 'review' : 'reward'}
      onClose={() => { setRewardOpen(false); if (closing.current) sheet.current?.dismiss(); }}
      onBack={reviewing && !waiting ? () => { wallet.editExpiredReview(); setReviewing(false); } : undefined}
      footer={<>
        {!!footerError && <Notice error text={footerError} />}
        {reviewing && operationId ? <Button variant={reviewPrepared ? reviewKind === 'refund' ? 'warning' : 'success' : 'secondary'} icon={reviewPrepared ? 'check' : 'refresh-cw'} busy={busy} disabled={reviewPrepared && reviewKind === 'release'} onPress={() => { if (reviewPrepared) void walletAction.current.approve(); else void walletAction.current.retry(); }}>{reviewPrepared ? t('Assinar na carteira') : t('Verificar transação')}</Button>
          : renewing ? <Button onPress={() => void save('renew')} busy={busy} disabled={saveDisabled}>{t('Salvar e revisar renovação')}</Button>
          : (lockedReward || legacyReward || wantsReward) && <Button icon="check" disabled={busy || !lockedReward && wantsReward && !canReserve} onPress={() => { Keyboard.dismiss(); rewardSheet.current?.dismiss(); }}>{t('Concluir')}</Button>}
      </>}>
      {reviewing && wallet.operation ? <RewardReview controller={wallet} /> : <>
        {lockedReward ? <>
          <RewardSummary reward={activeReward} amount={currentTag?.rewardAmount} currency={currentTag?.rewardCurrency} />
          {wallet.operation ? <Button variant="accent" icon="shield" onPress={() => { Keyboard.dismiss(); setReviewing(true); }}>{t('Retomar revisão')}</Button> : <>
            {activeReward?.refundAfter && <Text style={s.small}>{t('Cancelamento a partir de {date}', { date: new Date(activeReward.refundAfter).toLocaleString(locale) })}</Text>}
            {activeReward?.status === 'expired' && <>
              {renewing ? <><RewardPeriod quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} disabled={editingDisabled} refundAfter={activeReward?.refundAfter} />
                <Button variant="ghost" disabled={editingDisabled} onPress={() => setRenewing(false)}>{t('Cancelar renovação')}</Button></>
                : <Button variant="accent" icon="refresh-cw" disabled={editingDisabled} onPress={() => setRenewing(true)}>{t('Renovar reserva')}</Button>}
              {!renewing && <Button variant="warning" icon="corner-up-left" busy={busy} disabled={editingDisabled || !activeReward?.refundAfter || Date.parse(activeReward.refundAfter) > Date.now()} onPress={() => void save('refund')}>{t('Cancelar e recuperar')}</Button>}
            </>}
            {activeReward?.status === 'unverified' && <Notice tone="warning" text={t('Não foi possível confirmar a reserva agora. Aguarde a conexão com a rede antes de continuar.')} />}
          </>}
        </> : legacyReward ? <>
          <RewardSummary amount={currentTag?.rewardAmount} currency={currentTag?.rewardCurrency} />
          <Button variant="secondary" disabled={editingDisabled} onPress={() => setLegacyReward(false)}>{t('Usar recompensa em cripto')}</Button>
        </> : <>
          <RewardFields controller={wallet} value={reward} currency={currency} onValue={setReward} onCurrency={setCurrency} disabled={editingDisabled} />
          {wantsReward && <>
            <RewardPeriod quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} disabled={editingDisabled} />
            {wallet.data && !wallet.data.config && <Notice text={t('Os depósitos de recompensa ainda não estão disponíveis.')} />}
            {wallet.data?.config && !wallet.data.payer && <Notice text={t('Vincule sua carteira Solana em Minha conta para financiar uma recompensa.')} />}
          </>}
        </>}
      </>}
    </RewardEditorSheet>}
  </>;
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
