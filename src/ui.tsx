import React, { PropsWithChildren, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import Pressable from './HapticPressable';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Feather from '@expo/vector-icons/Feather';
import { usePreferences } from './PreferencesProvider';
import { Colors, darkColors, lightColors } from './theme';
import { createTranslator, translateNotice } from './i18n';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = usePreferences();
  return <Feather name={name} size={size} color={color ?? colors.ink} aria-hidden={true} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export function Brand() {
  const { C, s, t, locale } = useUI();
  return <View style={s.row}><View style={s.brandMark}><Icon name="crosshair" color={C.ink} size={24} /></View><Text style={s.brand}>SeekerTag</Text></View>;
}

export function Button({ children, onPress, icon, variant = 'primary', busy = false, disabled = false, style, label }: PropsWithChildren<{ onPress: () => void; icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'accent'; busy?: boolean; disabled?: boolean; style?: ViewStyle; label?: string }>) {
  const { C, s, t, locale } = useUI();
  const inactive = busy || disabled;
  const colors = { primary: [C.onPrimary, C.primary], secondary: [C.ink, C.secondary], ghost: [C.ink, 'transparent'], danger: [C.red, C.redSoft], success: [C.green, C.greenSoft], warning: [C.amber, C.amberSoft], accent: [C.accent, C.soft] };
  const [foreground, backgroundColor] = colors[variant];
  const color = disabled ? C.muted : foreground;
  const iconOnly = !children;
  return <Pressable accessibilityRole="button" accessibilityLabel={label || (typeof children === 'string' ? children : undefined)} accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor }, iconOnly && s.iconButton, disabled && { backgroundColor: variant === 'ghost' ? 'transparent' : C.surface }, pressed && { opacity: 0.72 }, style]}>
    {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Icon name={icon} color={color} size={iconOnly ? 26 : 22} /> : null}
    {!!children && <Text style={[s.buttonText, { color }]}>{children}</Text>}
  </Pressable>;
}

export function Field({ label, help, inSheet = false, hideLabel = false, onFocus, onBlur, ...props }: TextInputProps & { label: string; help?: string; inSheet?: boolean; hideLabel?: boolean }) {
  const { C, s, t, locale } = useUI();
  const [focused, setFocused] = useState(false);
  const Input = inSheet ? BottomSheetTextInput : TextInput;
  return <View style={{ gap: 10 }}>
    {!hideLabel && <Text style={s.label}>{label}</Text>}
    <Input accessibilityLabel={label} placeholderTextColor={C.muted} selectionColor={C.accent} cursorColor={C.ink} keyboardAppearance={C === darkColors ? "dark" : "light"} {...props}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[s.input, props.multiline && s.multiline, focused && s.inputFocused, props.style]} />
    {!!help && <Text style={s.small}>{help}</Text>}
  </View>;
}

export function Notice({ text, error = false, tone = 'info' }: { text: string; error?: boolean; tone?: 'info' | 'success' | 'warning' }) {
  const { C, s, t, locale } = useUI();
  const [color, backgroundColor] = error ? [C.red, C.redSoft] : tone === 'success' ? [C.green, C.greenSoft] : tone === 'warning' ? [C.amber, C.amberSoft] : [C.accent, C.soft];
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.notice, { backgroundColor }]}><Icon name={error || tone === 'warning' ? 'alert-circle' : tone === 'success' ? 'check-circle' : 'info'} size={21} color={color} /><Text style={[s.small, { color: error || tone !== 'info' ? color : C.ink, flex: 1 }]}>{translateNotice(t, text)}</Text></View>;
}

export function Pill({ status }: { status: 'active' | 'lost' | 'paused' }) {
  const { C, s, t, locale } = useUI();
  const [label, color, backgroundColor] = status === 'lost' ? [t("Perdido"), C.amber, C.amberSoft] : status === 'paused' ? [t("Pausado"), C.muted, C.surface] : [t("Protegido"), C.green, C.greenSoft];
  return <View style={[s.pill, { backgroundColor }]}><View style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: color }} /><Text style={{ fontSize: 13, fontWeight: '500', color }}>{label}</Text></View>;
}

// Detail screens use full-screen navigation. Short help and forms use Gorhom sheets.
// The app-level KeyboardProvider also tracks native Modals. Nested providers
// overwrite Android modal dismissal listeners and leave the root keyboard suspended.
export function Sheet({ title, subtitle, onClose, children, footer, headerRight, overlay, contentKey, dismissible = true }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; footer?: React.ReactNode; headerRight?: React.ReactNode; overlay?: React.ReactNode; contentKey?: string; dismissible?: boolean }>) {
  const { C, s, t, locale } = useUI();
  return <Modal visible animationType="slide" onRequestClose={() => { if (Keyboard.isVisible()) Keyboard.dismiss(); else if (dismissible) onClose(); }}>
    <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1 }} accessibilityElementsHidden={!!overlay} importantForAccessibility={overlay ? "no-hide-descendants" : "auto"}>
      <View style={s.screenHeader}>
        {dismissible ? <Button variant="ghost" onPress={onClose} icon="arrow-left" label={t("Fechar")} /> : <View style={{ width: 48 }} />}
        <Text accessibilityRole="header" style={s.screenTitle}>{title}</Text>{headerRight || <View style={{ width: 48 }} />}
      </View>
      <KeyboardAwareScrollView mode="layout" disableScrollOnKeyboardHide key={contentKey} style={{ flex: 1 }} bottomOffset={24} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 20, paddingBottom: 36, gap: 24, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        {!!subtitle && <Text style={s.body}>{subtitle}</Text>}{children}
      </KeyboardAwareScrollView>
      {!!footer && <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}>{footer}</View>}
      </View>
      {overlay}
    </SafeAreaView></GestureHandlerRootView>
  </Modal>;
}

export const formatDate = (date: string, locale: string) => new Date(date).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
const makeStyles = (C: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settingsIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  brandMark: { height: 40, width: 40, borderRadius: 14, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, brand: { color: C.ink, fontSize: 23, fontWeight: '600', letterSpacing: -0.5 },
  button: { minHeight: 58, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' }, iconButton: { minHeight: 48, minWidth: 48, paddingHorizontal: 10, paddingVertical: 10 }, buttonText: { fontSize: 18, lineHeight: 24, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
  label: { color: C.muted, fontSize: 16, lineHeight: 22, fontWeight: '500' }, input: { minHeight: 62, borderWidth: 2, borderColor: 'transparent', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: C.input, color: C.ink, fontSize: 18, lineHeight: 26 }, inputFocused: { backgroundColor: C.bg, borderColor: C.ink }, multiline: { minHeight: 120, textAlignVertical: 'top', paddingTop: 16 },
  h1: { color: C.ink, fontSize: 36, fontWeight: '700', letterSpacing: -0.8, lineHeight: 43 }, h2: { color: C.ink, fontSize: 25, fontWeight: '600', letterSpacing: -0.3, lineHeight: 32 }, h3: { color: C.ink, fontSize: 20, fontWeight: '500', lineHeight: 27 }, body: { color: C.muted, fontSize: 17, lineHeight: 26 }, small: { color: C.muted, fontSize: 14, lineHeight: 21 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 18 }, pill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20 },
  card: { backgroundColor: C.surface, borderRadius: 26, padding: 22 }, divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line }, overlay: { flex: 1, backgroundColor: '#000000B3', alignItems: 'center', justifyContent: 'center', padding: 20 },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 72, paddingHorizontal: 10, paddingVertical: 8 }, screenTitle: { flex: 1, textAlign: 'center', color: C.ink, fontSize: 21, fontWeight: '600', lineHeight: 28 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 36, gap: 18, minHeight: 270 }, circle: { width: 58, height: 58, borderRadius: 20, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
});

const darkStyles = makeStyles(darkColors);
const lightStyles = makeStyles(lightColors);
export function useUI() {
  const { colors, dark, language, locale } = usePreferences();
  const t = useMemo(() => createTranslator(language), [language]);
  return { C: colors, s: dark ? darkStyles : lightStyles, t, locale };
}
