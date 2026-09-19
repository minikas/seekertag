import React, { PropsWithChildren } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { NavigationScope, useNavigationLayer } from './Navigation';
import { Button, useUI } from './ui';

type Props = PropsWithChildren<{ title: string; onClose: () => void; footer?: React.ReactNode;
  headerRight?: React.ReactNode; contentKey?: string; overlay?: React.ReactNode;
  dismissible?: boolean; scrollable?: boolean; enabled?: boolean }>;

export default function Screen({ title, onClose, children, footer, headerRight, contentKey, overlay, dismissible = true, scrollable = true, enabled = true }: Props) {
  const { C, s, t } = useUI();
  const layer = useNavigationLayer(() => { if (dismissible) onClose(); }, false, enabled);
  return <NavigationScope path={layer.path}><View style={{ flex: 1, backgroundColor: C.bg }}>
    <View style={{ flex: 1 }} pointerEvents={layer.active ? 'auto' : 'none'} accessibilityElementsHidden={!layer.active} importantForAccessibility={layer.active ? 'auto' : 'no-hide-descendants'}>
      <View style={s.screenHeader}>
        <Button variant="ghost" icon="arrow-left" label={t('Voltar')} disabled={!dismissible} onPress={() => { Keyboard.dismiss(); onClose(); }} />
        <Text accessibilityRole="header" numberOfLines={2} style={s.screenTitle}>{title}</Text>{headerRight}
      </View>
      {scrollable ? <KeyboardAwareScrollView key={contentKey} mode="layout" disableScrollOnKeyboardHide bottomOffset={24} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 36, gap: 24, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        {children}
      </KeyboardAwareScrollView> : children}
      {!!footer && <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}>{footer}</View>}
    </View>
    {overlay}
  </View></NavigationScope>;
}
