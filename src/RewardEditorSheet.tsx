import React, { forwardRef, PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetFooter, BottomSheetFooterProps, BottomSheetHandle, BottomSheetHandleProps, BottomSheetModal } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardAwareSheetScrollView from './KeyboardAwareSheetScrollView';
import { Button, useUI } from './ui';

type Props = PropsWithChildren<{ title: string; busy: boolean; onClose: () => void; onBack?: () => void; footer: React.ReactNode; contentKey: string }>;
export default forwardRef<BottomSheetModal, Props>(function RewardEditorSheet({ title, busy, onClose, onBack, footer, contentKey, children }, forwardedRef) {
  const { C, s, t } = useUI();
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheetModal>(null);
  const alive = useRef(false);
  const snapPoints = useMemo(() => ['78%', '96%'], []);
  const [footerHeight, setFooterHeight] = useState(90 + insets.bottom);
  useEffect(() => {
    alive.current = true; sheet.current?.present();
    return () => { alive.current = false; sheet.current?.dismiss(); };
  }, []);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior={busy ? 'none' : 'close'} accessibilityLabel={t('Fechar')} onPress={Keyboard.dismiss} />, [busy, t]);
  const renderFooter = useCallback((props: BottomSheetFooterProps) => <BottomSheetFooter {...props}>
    <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 16, gap: 12, backgroundColor: C.popover }}>{footer}</View>
  </BottomSheetFooter>, [footer, insets.bottom, C.popover]);
  const handle = useCallback((props: BottomSheetHandleProps) => <View>
    <BottomSheetHandle {...props} indicatorStyle={{ backgroundColor: C.muted, width: 44, height: 5 }} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 }}>
      {onBack && <Button variant="ghost" icon="arrow-left" label={t('Voltar à recompensa')} disabled={busy} onPress={onBack} />}
      <Text accessibilityRole="header" style={[s.h2, { flex: 1 }]}>{title}</Text>
    </View>
  </View>, [C.muted, title, onBack, busy, s, t]);
  return <BottomSheetModal ref={value => { sheet.current = value; if (typeof forwardedRef === 'function') forwardedRef(value); else if (forwardedRef) forwardedRef.current = value; }}
    name="object-reward" stackBehavior="switch" snapPoints={snapPoints} index={0} enableDynamicSizing={false}
    enablePanDownToClose={!busy} enableHandlePanningGesture={!busy} enableContentPanningGesture={!busy}
    keyboardBehavior="interactive" keyboardBlurBehavior="none" android_keyboardInputMode="adjustPan" enableBlurKeyboardOnGesture={false}
    topInset={insets.top + 8} backdropComponent={backdrop} footerComponent={renderFooter} handleComponent={handle}
    backgroundStyle={{ backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}
    onDismiss={() => { Keyboard.dismiss(); if (alive.current) onClose(); }} accessibilityLabel={title}>
    <KeyboardAwareSheetScrollView key={contentKey} mode="layout" disableScrollOnKeyboardHide bottomOffset={footerHeight + 20}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="none" enableFooterMarginAdjustment
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 24, gap: 20 }}>
      {children}
    </KeyboardAwareSheetScrollView>
  </BottomSheetModal>;
});
