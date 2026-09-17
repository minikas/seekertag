import React, { forwardRef } from 'react';
import { Pressable, PressableProps, View } from 'react-native';
import * as Haptics from 'expo-haptics';

export function tapFeedback() {
  // Native Android touch feedback respects the device's haptic settings.
  void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => {});
}

export default forwardRef<View, PressableProps>(function HapticPressable({ onPress, disabled, ...props }, ref) {
  return <Pressable {...props} ref={ref} disabled={disabled} onPress={event => {
    if (disabled || !onPress) return;
    tapFeedback();
    onPress(event);
  }} />;
});
