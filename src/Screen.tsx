import React, { PropsWithChildren, useEffect } from 'react';
import { BackHandler, Keyboard, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, useUI } from './ui';

// Ordinary navigation stays in the app window, under the shared safe area and
// keyboard controller. Only transient tasks need a native Modal or bottom sheet.
export default function Screen({ title, onClose, children, footer, contentKey }: PropsWithChildren<{ title: string; onClose: () => void; footer?: React.ReactNode; contentKey?: string }>) {
  const { C, s, t } = useUI();
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) Keyboard.dismiss(); else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    <View style={s.screenHeader}>
      <Button variant="ghost" icon="arrow-left" label={t('Voltar')} onPress={() => { Keyboard.dismiss(); onClose(); }} />
      <Text accessibilityRole="header" style={s.screenTitle}>{title}</Text><View style={{ width: 48 }} />
    </View>
    <KeyboardAwareScrollView key={contentKey} mode="layout" disableScrollOnKeyboardHide bottomOffset={24} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingBottom: 36, gap: 24, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
      {children}
    </KeyboardAwareScrollView>
    {!!footer && <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}>{footer}</View>}
  </View>;
}
