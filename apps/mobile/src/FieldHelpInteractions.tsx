import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo } from 'react';
import { View } from 'react-native';

const Context = createContext({ dismiss: () => {}, subscribe: (_dismiss: () => void): (() => void) => () => {} });

export function FieldHelpInteractionProvider({ children }: PropsWithChildren) {
  const interactions = useMemo(() => {
    const listeners = new Set<() => void>();
    return {
      dismiss: () => listeners.forEach(dismiss => dismiss()),
      subscribe(dismiss: () => void) { listeners.add(dismiss); return () => { listeners.delete(dismiss); }; },
    };
  }, []);
  return <Context.Provider value={interactions}>
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={() => {
      // Observe the beginning of taps and drags without taking the gesture.
      interactions.dismiss();
      return false;
    }}>{children}</View>
  </Context.Provider>;
}

export const useDismissFieldHelp = () => useContext(Context).dismiss;

export function useDismissFieldHelpOnInteraction(dismiss: () => void, enabled: boolean) {
  const { subscribe } = useContext(Context);
  useEffect(() => enabled ? subscribe(dismiss) : undefined, [dismiss, enabled, subscribe]);
}
