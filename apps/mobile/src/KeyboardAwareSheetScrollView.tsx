import React, { memo } from 'react';
import { BottomSheetScrollView, BottomSheetScrollViewMethods, createBottomSheetScrollableComponent, SCROLLABLE_TYPE } from '@gorhom/bottom-sheet';
import { KeyboardAwareScrollView, KeyboardAwareScrollViewProps, KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

type Props = React.ComponentProps<typeof BottomSheetScrollView> & KeyboardAwareScrollViewProps;
export type KeyboardAwareSheetScrollViewRef = BottomSheetScrollViewMethods & KeyboardAwareScrollViewRef;
// Keep Gorhom's gesture coordination and Keyboard Controller's focus tracking.
const AnimatedScrollView = Animated.createAnimatedComponent(KeyboardAwareScrollView);
export default memo(createBottomSheetScrollableComponent<KeyboardAwareSheetScrollViewRef, Props>(SCROLLABLE_TYPE.SCROLLVIEW, AnimatedScrollView));
