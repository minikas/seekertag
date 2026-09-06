import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';

// KeyboardAvoidingView compares a local frame to the keyboard's screen frame.
// Measure its parent's screen origin so SafeArea/header nesting is accounted for.
export function useKeyboardFrame() {
  const ref = useRef<View>(null); const [offset, setOffset] = useState(0); const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const onLayout = useCallback(() => {
    if (Platform.OS !== 'web') ref.current?.measureInWindow((_x, y) => { if (Number.isFinite(y)) setOffset(Math.max(0, y)); });
  }, []);
  return { ref, onLayout, offset, visible };
}
