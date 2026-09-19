import React, { forwardRef, PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { BottomSheetBackdropProps, BottomSheetFooter, BottomSheetFooterProps, BottomSheetHandle, BottomSheetHandleProps, BottomSheetModal } from '@gorhom/bottom-sheet';
import SheetBackdrop from './SheetBackdrop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardAwareSheetScrollView from './KeyboardAwareSheetScrollView';
import { NavigationScope, useNavigationLayer } from './Navigation';
import { Button, useUI } from './ui';

type Props = PropsWithChildren<{ title: string; titleAccessory?: React.ReactNode; busy: boolean; onClose: () => void; onBack?: () => void; onRequestClose?: () => void; preventDismiss?: boolean; footer: React.ReactNode; contentKey: string }>;
export default forwardRef<BottomSheetModal, Props>(function RewardEditorSheet({ title, titleAccessory, busy, onClose, onBack, onRequestClose, preventDismiss = false, footer, contentKey, children }, forwardedRef) {
  const { C, s, t } = useUI();
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheetModal>(null);
  const alive = useRef(false);
  const snapPoints = useMemo(() => ['70%', '94%'], []);
  const close = useCallback(() => { if (!busy) { if (onRequestClose) onRequestClose(); else { Keyboard.dismiss(); sheet.current?.dismiss(); } } }, [busy, onRequestClose]);
  const layer = useNavigationLayer(() => { if (!busy) { if (onBack) onBack(); else close(); } }, true);
  const [footerHeight, setFooterHeight] = useState(90 + insets.bottom);
  useEffect(() => {
    alive.current = true; sheet.current?.present();
    return () => { alive.current = false; sheet.current?.dismiss(); };
  }, []);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <SheetBackdrop {...props} onPress={close} disabled={busy} label={t('Fechar')} />, [busy, close, t]);
  const renderFooter = useCallback((props: BottomSheetFooterProps) => <BottomSheetFooter {...props}>
    <View accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'} onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 16, gap: 12, backgroundColor: C.popover }}>{footer}</View>
  </BottomSheetFooter>, [footer, insets.bottom, C.popover, layer.active]);
  const handle = useCallback((props: BottomSheetHandleProps) => <View>
    <BottomSheetHandle {...props} indicatorStyle={{ backgroundColor: C.muted, width: 44, height: 5 }} />
    <View pointerEvents={layer.active ? 'auto' : 'none'} accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 }}>
      {onBack && <Button variant="ghost" icon="arrow-left" label={t('Voltar à recompensa')} disabled={busy} onPress={onBack} />}
      <View style={{ flex: 1, minWidth: 0, flexDirection: titleAccessory ? 'row' : 'column', alignItems: titleAccessory ? 'center' : 'flex-start', justifyContent: titleAccessory ? 'center' : 'flex-start', gap: titleAccessory ? 10 : 0 }}>
        <Text accessibilityRole="header" style={[s.h2, { flexShrink: 1 }]}>{title}</Text>{titleAccessory && <View style={{ flexShrink: 0 }}>{titleAccessory}</View>}
      </View>
      {!onBack && <Button variant="ghost" icon="x" label={t('Fechar')} disabled={busy} onPress={close} />}
    </View>
  </View>, [C.muted, title, titleAccessory, onBack, close, busy, s, t, layer.active]);
  return <NavigationScope path={layer.path}><BottomSheetModal ref={value => { sheet.current = value; if (typeof forwardedRef === 'function') forwardedRef(value); else if (forwardedRef) forwardedRef.current = value; }}
    name="object-reward" stackBehavior="push" snapPoints={snapPoints} index={0} enableDynamicSizing={false}
    enablePanDownToClose={!busy && !preventDismiss} enableHandlePanningGesture={!busy} enableContentPanningGesture={!busy}
    keyboardBehavior="fillParent" keyboardBlurBehavior="none" android_keyboardInputMode="adjustResize" enableBlurKeyboardOnGesture={false}
    topInset={insets.top + 8} backdropComponent={backdrop} footerComponent={renderFooter} handleComponent={handle}
    backgroundStyle={{ backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}
    onDismiss={() => { Keyboard.dismiss(); if (alive.current) onClose(); }} accessibilityLabel={title}>
    <NavigationScope path={layer.path}><KeyboardAwareSheetScrollView accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'} key={contentKey} mode="layout" disableScrollOnKeyboardHide bottomOffset={footerHeight + 20}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="none" enableFooterMarginAdjustment
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 24, gap: 20 }}>
      {children}
    </KeyboardAwareSheetScrollView></NavigationScope>
  </BottomSheetModal></NavigationScope>;
});
