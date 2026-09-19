import React, { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View, ViewStyle } from 'react-native';
import { Portal } from '@gorhom/portal';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Pressable from './HapticPressable';
import Screen from './Screen';
import { PageLayer } from './Navigation';
import { motion } from './motion';
import { displayTagStatus } from './tag-status.model';
import { useDismissFieldHelp, useDismissFieldHelpOnInteraction } from './FieldHelpInteractions';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
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

export function Field({ label, help, tooltip, error, inSheet = false, hideLabel = false, onFocus, onBlur, onChangeText, ...props }: TextInputProps & { label: string; help?: string; tooltip?: string; error?: string; inSheet?: boolean; hideLabel?: boolean }) {
  const { C, s, t, locale } = useUI();
  const dismissHelp = useDismissFieldHelp();
  const [focused, setFocused] = useState(false);
  const Input = inSheet ? BottomSheetTextInput : TextInput;
  const tooltipHelp = !hideLabel && tooltip;
  return <View style={{ gap: 10 }}>
    {!hideLabel && (tooltipHelp ? <View style={s.between}>
      <Text style={[s.label, { flex: 1 }]}>{label}</Text><FieldHelp label={label} text={tooltipHelp} />
    </View> : <Text style={s.label}>{label}</Text>)}
    <Input accessibilityLabel={label} accessibilityHint={error || [help, tooltip].filter(Boolean).join(' ') || undefined} placeholderTextColor={C.muted} selectionColor={C.accent} cursorColor={C.ink} keyboardAppearance={C === darkColors ? "dark" : "light"} {...props}
      onFocus={event => { dismissHelp(); setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
      onChangeText={value => { dismissHelp(); onChangeText?.(value); }}
      style={[s.input, props.multiline && s.multiline, focused && s.inputFocused, !!error && { borderColor: C.red }, props.style]} />
    {!!error ? <Text accessibilityRole="alert" style={[s.small, { color: C.red }]}>{error}</Text> : !!help && <Text style={s.small}>{help}</Text>}
  </View>;
}

function FieldHelp({ label, text }: { label: string; text: string }) {
  const { C, s, t } = useUI();
  const trigger = useRef<View>(null);
  const opening = useRef(false);
  const closing = useRef(false);
  const dismissOnPress = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number }>();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    progress.value = withTiming(0, { duration: motion.tooltipExit, easing: motion.easeOut, reduceMotion: ReduceMotion.Never }, finished => {
      if (finished) runOnJS(setAnchor)(undefined);
    });
  }, [progress]);
  useDismissFieldHelpOnInteraction(close, !!anchor);
  useEffect(() => {
    if (!anchor) return;
    // Dismiss help before the keyboard or the underlying form handles Back.
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    const keyboardShown = Keyboard.addListener('keyboardDidShow', close);
    const keyboardHidden = Keyboard.addListener('keyboardDidHide', close);
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') close(); });
    return () => { back.remove(); keyboardShown.remove(); keyboardHidden.remove(); appState.remove(); };
  }, [anchor, close]);
  const bubbleWidth = Math.min(280, width - 32);
  const above = !!anchor && anchor.y > height / 2;
  const left = anchor ? Math.max(16, Math.min(width - bubbleWidth - 16, anchor.x + anchor.width - bubbleWidth)) : 16;
  const originX = anchor ? Math.max(12, Math.min(bubbleWidth - 12, anchor.x + anchor.width / 2 - left)) : bubbleWidth / 2;
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: reduceMotion ? 1 : 0.97 + 0.03 * progress.value }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: reduceMotion ? 1 : pressScale.value }] }));
  return <>
    <Pressable ref={trigger} collapsable={false} accessibilityRole="button" accessibilityLabel={t('Informações sobre {name}', { name: label })}
      accessibilityState={{ expanded: !!anchor }}
      onPressIn={() => { dismissOnPress.current = !!anchor; pressScale.value = withTiming(0.9, { duration: 100, easing: motion.easeOut }); }}
      onPressOut={() => { pressScale.value = withTiming(1, { duration: 125, easing: motion.easeOut }); }}
      onPress={() => {
        if (anchor || dismissOnPress.current) { dismissOnPress.current = false; close(); return; }
        trigger.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
          opening.current = false; closing.current = false; progress.value = 0;
          setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
        });
      }}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}>
      <Animated.View style={iconStyle}><Icon name="info" size={20} color={C.muted} /></Animated.View>
    </Pressable>
    {anchor && <Portal hostName="field-help">
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 10000 }]} onAccessibilityEscape={close}>
        <Animated.View pointerEvents="none" onLayout={() => {
          if (opening.current || closing.current) return;
          opening.current = true;
          progress.value = withTiming(1, { duration: motion.tooltipEnter, easing: motion.easeOut, reduceMotion: ReduceMotion.Never });
        }} style={[{ position: 'absolute', width: bubbleWidth, left,
          ...(above ? { bottom: height - anchor.y + 8 } : { top: anchor.y + anchor.height + 8 }),
          transformOrigin: [originX, above ? '100%' : '0%', 0],
          padding: 12, borderRadius: 12, backgroundColor: C.primary, elevation: 8 }, bubbleStyle]}>
          <View style={{ position: 'absolute', left: originX - 5, width: 10, height: 10,
            ...(above ? { bottom: -5 } : { top: -5 }), backgroundColor: C.primary, transform: [{ rotate: '45deg' }] }} />
          <Text accessible accessibilityLiveRegion="polite" style={[s.small, { color: C.onPrimary }]}>{text}</Text>
        </Animated.View>
      </View>
    </Portal>}
  </>;
}

export function Notice({ text, error = false, tone = 'info' }: { text: string; error?: boolean; tone?: 'info' | 'success' | 'warning' }) {
  const { C, s, t, locale } = useUI();
  const [color, backgroundColor] = error ? [C.red, C.redSoft] : tone === 'success' ? [C.green, C.greenSoft] : tone === 'warning' ? [C.amber, C.amberSoft] : [C.accent, C.soft];
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.notice, { backgroundColor }]}><Icon name={error || tone === 'warning' ? 'alert-circle' : tone === 'success' ? 'check-circle' : 'info'} size={21} color={color} /><Text style={[s.small, { color: error || tone !== 'info' ? color : C.ink, flex: 1 }]}>{translateNotice(t, text)}</Text></View>;
}

export function Pill({ status, recoveryCount = 0 }: { status: 'active' | 'lost' | 'paused'; recoveryCount?: number }) {
  const { C, s, t, locale } = useUI();
  const state = displayTagStatus({ status, recoveryCount });
  const [label, color, backgroundColor] = state === 'lost' ? [t("Perdido"), C.orange, C.orangeSoft] : state === 'recovered' ? [t('Reencontrado'), C.blue, C.blueSoft] : state === 'paused' ? [t("Arquivado"), C.muted, C.surface] : [t("Protegido"), C.green, C.greenSoft];
  return <View style={[s.pill, { backgroundColor }]}><View style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: color }} /><Text style={{ fontSize: 13, fontWeight: '500', color }}>{label}</Text></View>;
}

// Full-screen pages stay in the same window as the shared sheet portal.
export function Sheet({ title, subtitle, onClose, children, ...props }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; footer?: React.ReactNode; headerRight?: React.ReactNode; overlay?: React.ReactNode; contentKey?: string; dismissible?: boolean; scrollable?: boolean }>) {
  const { s } = useUI();
  return <PageLayer><Screen title={title} onClose={onClose} {...props}>
    {!!subtitle && <Text style={s.body}>{subtitle}</Text>}{children}
  </Screen></PageLayer>;
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
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 72, paddingHorizontal: 10, paddingVertical: 8 }, screenTitle: { flex: 1, flexShrink: 1, minWidth: 0, textAlign: 'left', color: C.ink, fontSize: 21, fontWeight: '600', lineHeight: 28 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 36, gap: 18, minHeight: 270 }, circle: { width: 58, height: 58, borderRadius: 20, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
});

const darkStyles = makeStyles(darkColors);
const lightStyles = makeStyles(lightColors);
export function useUI() {
  const { colors, dark, language, locale } = usePreferences();
  const t = useMemo(() => createTranslator(language), [language]);
  return { C: colors, s: dark ? darkStyles : lightStyles, t, locale };
}
