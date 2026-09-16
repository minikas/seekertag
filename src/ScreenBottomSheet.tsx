import React, { PropsWithChildren, useCallback } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from './ui';

// Render inside a Sheet's native Modal so gestures and the backdrop stay above it.
export default function ScreenBottomSheet({ title, onClose, children }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const { C, s, t } = useUI();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} pressBehavior="close" accessibilityLabel={t('Fechar')} />, [t]);
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
    <BottomSheet enableDynamicSizing enablePanDownToClose maxDynamicContentSize={height - insets.top - insets.bottom - 24} backdropComponent={backdrop} onClose={onClose}
      backgroundStyle={{ backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 }} handleIndicatorStyle={{ backgroundColor: C.muted, width: 44, height: 5 }}>
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 20 }}>
        <Text accessibilityRole="header" style={s.h2}>{title}</Text>
        {children}
      </BottomSheetScrollView>
    </BottomSheet>
  </View>;
}
