import React, { forwardRef, useCallback, useRef } from 'react';
import { findNodeHandle, Pressable, PressableProps, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRememberNavigationFocus } from './Navigation';

export function tapFeedback() {
  // Native Android touch feedback respects the device's haptic settings.
  void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => {});
}

export default forwardRef<View, PressableProps>(function HapticPressable({ onPress, disabled, ...props }, ref) {
  const element = useRef<View>(null);
  const rememberFocus = useRememberNavigationFocus();
  const setRef = useCallback((node: View | null) => {
    element.current = node;
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
  }, [ref]);
  return <Pressable {...props} ref={setRef} disabled={disabled} onPress={event => {
    if (disabled || !onPress) return;
    rememberFocus(findNodeHandle(element.current));
    tapFeedback();
    onPress(event);
  }} />;
});
