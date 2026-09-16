import React, { PropsWithChildren, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import Pressable from './HapticPressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';
import Feather from '@expo/vector-icons/Feather';

// Seeker-inspired surfaces. Primary actions stay white; cyan marks activity.
export const C = {
  bg: '#0D1615', surface: '#1C2524', popover: '#0D1615', raised: '#414B4A',
  input: '#35403F', secondary: '#32434B', primary: '#FFFFFF', onPrimary: '#080E0D',
  ink: '#FFFFFF', muted: '#92A5A7', line: '#263130',
  accent: '#00BDCD', onAccent: '#062325', soft: '#133234',
  green: '#22C76B', greenSoft: '#143326',
  amber: '#F0BF75', amberSoft: '#342C1F',
  red: '#FF848D', redSoft: '#342226', redLine: '#653940',
};
export type IconName = React.ComponentProps<typeof Feather>['name'];
export const Icon = ({ name, size = 24, color = C.ink }: { name: IconName; size?: number; color?: string }) => <Feather name={name} size={size} color={color} aria-hidden={true} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;

export function Brand() {
  return <View style={s.row}><View style={s.brandMark}><Icon name="crosshair" color={C.ink} size={24} /></View><Text style={s.brand}>SeekerTag</Text></View>;
}

export function Button({ children, onPress, icon, variant = 'primary', busy = false, disabled = false, style, label }: PropsWithChildren<{ onPress: () => void; icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean; style?: ViewStyle; label?: string }>) {
  const inactive = busy || disabled;
  const color = disabled ? C.muted : variant === 'primary' ? C.onPrimary : variant === 'danger' ? C.red : C.ink;
  const iconOnly = !children;
  return <Pressable accessibilityRole="button" accessibilityLabel={label || (typeof children === 'string' ? children : undefined)} accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor: variant === 'primary' ? C.primary : variant === 'secondary' ? C.secondary : variant === 'danger' ? C.redSoft : 'transparent' }, iconOnly && s.iconButton, disabled && { backgroundColor: variant === 'ghost' ? 'transparent' : C.surface }, pressed && { opacity: 0.72 }, style]}>
    {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Icon name={icon} color={color} size={iconOnly ? 26 : 22} /> : null}
    {!!children && <Text style={[s.buttonText, { color }]}>{children}</Text>}
  </Pressable>;
}

export function Field({ label, help, inSheet = false, hideLabel = false, onFocus, onBlur, ...props }: TextInputProps & { label: string; help?: string; inSheet?: boolean; hideLabel?: boolean }) {
  const [focused, setFocused] = useState(false);
  const Input = inSheet ? BottomSheetTextInput : TextInput;
  return <View style={{ gap: 10 }}>
    {!hideLabel && <Text style={s.label}>{label}</Text>}
    <Input accessibilityLabel={label} placeholderTextColor={C.muted} selectionColor={C.accent} cursorColor={C.ink} keyboardAppearance="dark" {...props}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[s.input, props.multiline && s.multiline, focused && s.inputFocused, props.style]} />
    {!!help && <Text style={s.small}>{help}</Text>}
  </View>;
}

export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.notice, { backgroundColor: error ? C.redSoft : C.soft }]}><Icon name={error ? 'alert-circle' : 'info'} size={21} color={error ? C.red : C.accent} /><Text style={[s.small, { color: error ? C.red : C.ink, flex: 1 }]}>{text}</Text></View>;
}

export function Pill({ status }: { status: 'active' | 'lost' | 'paused' }) {
  const [label, color, backgroundColor] = status === 'lost' ? ['Perdido', C.amber, C.amberSoft] : status === 'paused' ? ['Pausado', C.muted, C.surface] : ['Protegido', C.green, C.greenSoft];
  return <View style={[s.pill, { backgroundColor }]}><View style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: color }} /><Text style={{ fontSize: 13, fontWeight: '500', color }}>{label}</Text></View>;
}

// Detail screens use full-screen navigation. Short help and forms use Gorhom sheets.
export function Sheet({ title, subtitle, onClose, children, footer, dismissible = true }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; footer?: React.ReactNode; dismissible?: boolean }>) {
  return <Modal visible animationType="slide" onRequestClose={() => { if (Keyboard.isVisible()) Keyboard.dismiss(); else if (dismissible) onClose(); }}>
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent><SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.screenHeader}>
        {dismissible ? <Button variant="ghost" onPress={onClose} icon="arrow-left" label="Fechar" /> : <View style={{ width: 48 }} />}
        <Text accessibilityRole="header" style={s.screenTitle}>{title}</Text><View style={{ width: 48 }} />
      </View>
      <KeyboardAwareScrollView style={{ flex: 1 }} bottomOffset={24} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 20, paddingBottom: 36, gap: 24, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        {!!subtitle && <Text style={s.body}>{subtitle}</Text>}{children}
      </KeyboardAwareScrollView>
      {!!footer && <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}>{footer}</View>}
    </SafeAreaView></KeyboardProvider>
  </Modal>;
}

export const categories: { name: string; icon: IconName; color: string }[] = [
  { name: 'Mochila', icon: 'shopping-bag', color: '#304441' }, { name: 'Mala', icon: 'briefcase', color: '#34434B' },
  { name: 'Chaves', icon: 'key', color: '#404A44' }, { name: 'Pet', icon: 'heart', color: '#3E4144' },
  { name: 'Eletrônico', icon: 'headphones', color: '#30454A' }, { name: 'Outro', icon: 'box', color: '#414B4A' },
];
export const categoryInfo = (name: string) => categories.find(c => c.name === name) || categories[5];
export const formatDate = (date: string) => new Date(date).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
export const s = StyleSheet.create({
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
