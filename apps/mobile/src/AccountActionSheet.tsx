import React, { forwardRef, PropsWithChildren, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Keyboard, type StyleProp, Text, type TextStyle, useWindowDimensions, View } from 'react-native';
import { BottomSheetBackdropProps, BottomSheetModal } from '@gorhom/bottom-sheet';
import SheetBackdrop from './SheetBackdrop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationScope, useNavigationLayer } from './Navigation';
import { Button, useUI } from './ui';
import KeyboardAwareSheetScrollView from './KeyboardAwareSheetScrollView';

export type AccountActionSheetHandle = { dismiss: () => void };
type Props = PropsWithChildren<{ title?: string; titleStyle?: StyleProp<TextStyle>; onClose: () => void; busy?: boolean; onBack?: () => void;
  headerRight?: React.ReactNode; guardClose?: (dismiss: () => void) => void; contentKey?: string }>;

export default forwardRef<AccountActionSheetHandle, Props>(function AccountActionSheet({ title, titleStyle, onClose, children, busy = false, onBack, headerRight, guardClose, contentKey }, ref) {
  const { C, s, t } = useUI();
  const sheet = useRef<BottomSheetModal>(null);
  const mounted = useRef(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const busyRef = useRef(busy); busyRef.current = busy;
  const dismiss = useCallback(() => { if (!busyRef.current) { Keyboard.dismiss(); sheet.current?.dismiss(); } }, []);
  const requestClose = () => { if (!busy) { if (guardClose) guardClose(dismiss); else dismiss(); } };
  const layer = useNavigationLayer(() => { if (!busy) { if (onBack) onBack(); else requestClose(); } }, true);
  const topInset = insets.top + 8 + Math.min(3, layer.path.length - 1) * 36;
  useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);
  useEffect(() => {
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    return () => { mounted.current = false; modal?.dismiss(); };
  }, []);
  const backdrop = (props: BottomSheetBackdropProps) => <SheetBackdrop {...props} onPress={requestClose} disabled={busy} label={t('Fechar')} />;
  return <NavigationScope path={layer.path}><BottomSheetModal ref={sheet} stackBehavior="push" enableDynamicSizing enablePanDownToClose={!busy && !guardClose} enableContentPanningGesture={!busy} enableHandlePanningGesture={!busy} keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" topInset={topInset} maxDynamicContentSize={height - topInset - insets.bottom - 16}
    backdropComponent={backdrop} backgroundStyle={{ backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}
    handleIndicatorStyle={{ backgroundColor: C.muted, width: 44, height: 5 }} onDismiss={() => { if (mounted.current) onClose(); }}>
    <NavigationScope path={layer.path}><KeyboardAwareSheetScrollView key={contentKey} mode="layout" disableScrollOnKeyboardHide bottomOffset={insets.bottom + 24} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 24, gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{onBack && <Button variant="ghost" icon="arrow-left" label={t('Voltar')} disabled={busy} onPress={onBack} />}<Text accessibilityRole="header" style={[s.h2, { flex: 1 }, titleStyle]}>{title}</Text>{headerRight}{!onBack && <Button variant="ghost" icon="x" label={t('Fechar')} disabled={busy} onPress={requestClose} />}</View>
      {children}
    </KeyboardAwareSheetScrollView></NavigationScope>
  </BottomSheetModal></NavigationScope>;
});
