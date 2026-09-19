import React from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetBackdrop, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import Pressable from './HapticPressable';

type Props = BottomSheetBackdropProps & { onPress: () => void; label: string; disabled?: boolean; opacity?: number };

export default function SheetBackdrop({ onPress, label, disabled = false, opacity = 0.35, ...props }: Props) {
  // Gorhom ignores onPress when pressBehavior="none". A child handles the tap
  // so the caller can confirm unsaved changes before deciding to dismiss.
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={opacity} pressBehavior="none" accessible={false}>
    <Pressable testID="sheet-backdrop" accessibilityRole="button" accessibilityLabel={label}
      disabled={disabled} onPress={onPress} style={StyleSheet.absoluteFill} />
  </BottomSheetBackdrop>;
}
