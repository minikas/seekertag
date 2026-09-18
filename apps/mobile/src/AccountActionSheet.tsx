import React, { forwardRef, PropsWithChildren, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { BackHandler, Text, useWindowDimensions, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModal } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, useUI } from './ui';
import KeyboardAwareSheetScrollView from './KeyboardAwareSheetScrollView';

export type AccountActionSheetHandle = { dismiss: () => void };

// Keep the account screen mounted behind quick actions, including its scroll position.
export default forwardRef<AccountActionSheetHandle, PropsWithChildren<{ title?: string; onClose: () => void; busy?: boolean; onBack?: () => void; headerRight?: React.ReactNode }>>(function AccountActionSheet({ title, onClose, children, busy = false, onBack, headerRight }, ref) {
  const { C, s, t } = useUI();
  const sheet = useRef<BottomSheetModal>(null);
  const mounted = useRef(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const busyRef = useRef(busy); busyRef.current = busy;
  const dismiss = useCallback(() => { if (!busyRef.current) sheet.current?.dismiss(); }, []);
  useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);
  useEffect(() => {
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    const back = BackHandler.addEventListener('hardwareBackPress', () => { dismiss(); return true; });
    return () => { mounted.current = false; back.remove(); modal?.dismiss(); };
  }, [dismiss]);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior={busy ? 'none' : 'close'} accessibilityLabel={t("Fechar")} />, [t, busy]);
  return <BottomSheetModal ref={sheet} stackBehavior="push" enableDynamicSizing enablePanDownToClose={!busy} enableContentPanningGesture={!busy} enableHandlePanningGesture={!busy} keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" topInset={insets.top + 8} maxDynamicContentSize={height - insets.top - 32}
    backdropComponent={backdrop} backgroundStyle={{ backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}
    handleIndicatorStyle={{ backgroundColor: C.muted, width: 44, height: 5 }} onDismiss={() => { if (mounted.current) onClose(); }}>
    <KeyboardAwareSheetScrollView mode="layout" disableScrollOnKeyboardHide bottomOffset={insets.bottom + 24} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 24, gap: 20 }}>
      {!!title && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{onBack && <Button variant="ghost" icon="arrow-left" label={t('Voltar')} disabled={busy} onPress={onBack} />}<Text accessibilityRole="header" style={[s.h2, { flex: 1 }]}>{title}</Text>{headerRight}</View>}
      {children}
    </KeyboardAwareSheetScrollView>
  </BottomSheetModal>;
});
