import { useCallback } from 'react';
import { useAnimatedProps, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from './motion';

// A short, interruptible transition makes a direction change visible without moving the page layout.
const transition = { duration: 180, easing: motion.easeOut };

export function useScrollHeader(height: number) {
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(true);
  const progress = useSharedValue(1);
  const previousY = useSharedValue(0);
  const travel = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: () => { travel.value = 0; },
    onScroll: event => {
      const maxY = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
      const y = Math.max(0, Math.min(event.contentOffset.y, maxY));
      const delta = y - previousY.value;
      previousY.value = y;
      if (delta !== 0) travel.value = Math.sign(delta) === Math.sign(travel.value) ? travel.value + delta : delta;
      const next = y <= 8 || travel.value < -10 ? true : y > 24 && travel.value > 10 ? false : shown.value;
      if (next !== shown.value) {
        shown.value = next;
        progress.value = withTiming(next ? 1 : 0, transition);
      }
    },
  });
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : -height * (1 - progress.value) }],
    pointerEvents: shown.value ? 'auto' : 'none',
  }));
  const accessibilityProps = useAnimatedProps(() => ({
    accessibilityElementsHidden: !shown.value,
    importantForAccessibility: shown.value ? 'auto' as const : 'no-hide-descendants' as const,
  }));
  const reset = useCallback(() => {
    previousY.value = 0; travel.value = 0; shown.value = true;
    progress.value = withTiming(1, transition);
  }, [previousY, travel, shown, progress]);
  return { onScroll, style, accessibilityProps, reset };
}
