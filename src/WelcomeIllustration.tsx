import React, { PropsWithChildren, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, SharedValue, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useUI } from './ui';

// Decorative vector artwork stays crisp at every density and follows the app theme.
const ORBIT_DURATION = 72_000;
const ORBIT_RADIUS = 174;

function Satellite({ angle, degrees, width, height = width, children }: PropsWithChildren<{ angle: SharedValue<number>; degrees: number; width: number; height?: number }>) {
  const radians = degrees * Math.PI / 180;
  const x = 200 + ORBIT_RADIUS * Math.cos(radians) - width / 2;
  const y = 200 + ORBIT_RADIUS * Math.sin(radians) - height / 2;
  // Counter-rotate the artwork so objects stay upright while orbiting.
  const upright = useAnimatedStyle(() => ({ transform: [{ rotate: `${-angle.value}deg` }] }));
  return <Animated.View style={[{ position: 'absolute', left: `${x / 4}%`, top: `${y / 4}%`, width: `${width / 4}%`, height: `${height / 4}%` }, upright]}>
    <Svg width="100%" height="100%" viewBox={`-8 -8 ${width + 16} ${height + 16}`}>{children}</Svg>
  </Animated.View>;
}

export default function WelcomeIllustration({ paused = false }: { paused?: boolean }) {
  const { C } = useUI();
  const angle = useSharedValue(0);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReducedMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    const app = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (!paused && foreground && !reducedMotion) {
      // Resume from the same phase. Each repeat resets by exactly one full turn.
      const phase = angle.value % 360;
      angle.value = phase;
      angle.value = withRepeat(withTiming(phase + 360, { duration: ORBIT_DURATION, easing: Easing.linear }), -1, false);
    }
    return () => cancelAnimation(angle);
  }, [angle, foreground, paused, reducedMotion]);
  const orbit = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: '100%', aspectRatio: 1 }}>
    <Svg width="100%" height="100%" viewBox="0 0 400 400">
      <Defs><LinearGradient id="tag" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={C.accent} /><Stop offset="1" stopColor="#58DBAF" /></LinearGradient></Defs>
      <Circle cx="200" cy="200" r={ORBIT_RADIUS} stroke={C.line} strokeWidth="1" fill="none" />
      <Circle cx="200" cy="200" r="112" stroke={C.line} strokeWidth="1" fill="none" />
      <Circle cx="200" cy="200" r="84" fill={C.soft} />
      <G transform="rotate(-12 200 200)">
        <Rect x="148" y="122" width="108" height="151" rx="27" fill={C.bg} stroke={C.line} strokeWidth="2" />
        <Rect x="140" y="115" width="108" height="151" rx="27" fill="url(#tag)" />
        <Circle cx="194" cy="137" r="7" fill={C.bg} />
        <Path d="M194 130 C170 91 207 81 207 105 C207 115 200 129 194 137" stroke={C.muted} strokeWidth="4" fill="none" strokeLinecap="round" />
        <G fill="none" stroke="#083B38" strokeWidth="5" strokeLinejoin="round">
          <Rect x="162" y="164" width="22" height="22" rx="3" /><Rect x="204" y="164" width="22" height="22" rx="3" /><Rect x="162" y="205" width="22" height="22" rx="3" />
          <Path d="M204 205h10v11h12v11h-22 M195 173v23h-22 M162 196h-5 M224 196h4 M195 225v5" />
        </G>
      </G>
    </Svg>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, orbit]}>
      <Satellite angle={angle} degrees={-140} width={58}><G transform="rotate(-12 28 28)">
        <Rect width="58" height="58" rx="19" fill={C.secondary} />
        <G stroke={C.ink} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><Rect x="16" y="18" width="27" height="29" rx="7" /><Path d="M23 18v-4a6 6 0 0112 0v4 M16 30h27 M24 35h11v7H24z" /></G>
      </G></Satellite>
      <Satellite angle={angle} degrees={-35} width={54}><G transform="rotate(12 26 26)">
        <Rect width="54" height="54" rx="18" fill={C.amberSoft} />
        <G stroke={C.amber} strokeWidth="3" fill="none" strokeLinecap="round"><Circle cx="23" cy="23" r="8" /><Path d="M29 29l12 12m-6-6l4-4m-1 7l4-4" /></G>
      </G></Satellite>
      <Satellite angle={angle} degrees={145} width={54}><G transform="rotate(-8 26 26)">
        <Rect width="54" height="54" rx="18" fill={C.soft} />
        <G stroke={C.accent} strokeWidth="2.5" fill="none" strokeLinecap="round"><Path d="M14 29v-5a13 13 0 0126 0v5" /><Rect x="12" y="26" width="7" height="15" rx="3" /><Rect x="35" y="26" width="7" height="15" rx="3" /></G>
      </G></Satellite>
      <Satellite angle={angle} degrees={50} width={68} height={52}><G transform="rotate(8 26 26)">
        <Rect width="68" height="52" rx="20" fill={C.greenSoft} />
        <Path d="M23 27l7 7 15-16" stroke={C.green} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </G></Satellite>
    </Animated.View>
  </View>;
}
