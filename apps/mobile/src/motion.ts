import { Easing } from 'react-native-reanimated';

// Shared, fast-starting curve for small interface transitions.
export const motion = {
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
  tooltipEnter: 160,
  tooltipExit: 125,
};
