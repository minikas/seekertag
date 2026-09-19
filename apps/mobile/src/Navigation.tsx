import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import { ConversationDrafts, createNavigationStore } from './navigation.model';

const Store = createContext<ReturnType<typeof createNavigationStore> | null>(null);
const Path = createContext<readonly number[]>([]);
const Drafts = createContext<ConversationDrafts | null>(null);
let nextId = 0;

export function NavigationProvider({ children }: PropsWithChildren) {
  const [store] = useState(createNavigationStore);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const target = store.focusTarget(state.top);
    if (!target) return;
    let live = true;
    const timer = setTimeout(() => {
      void AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
        if (live && enabled) AccessibilityInfo.setAccessibilityFocus(target);
      }).catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [store, state.top]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) { Keyboard.dismiss(); return true; }
      return store.back();
    });
    return () => sub.remove();
  }, [store]);
  return <Store.Provider value={store}>{children}</Store.Provider>;
}

export function ConversationDraftProvider({ children }: PropsWithChildren) {
  const [drafts] = useState(() => new ConversationDrafts());
  return <Drafts.Provider value={drafts}>{children}</Drafts.Provider>;
}
export const useConversationDrafts = () => useContext(Drafts);

export function useRememberNavigationFocus() {
  const store = useContext(Store);
  return (target: number | null) => { if (target !== null) store?.rememberFocus(target); };
}

export function useNavigationState() {
  const store = useContext(Store);
  if (!store) throw new Error('NavigationProvider is required');
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useNavigationLayer(onBack: () => void, task = false, enabled = true) {
  const store = useContext(Store);
  if (!store) throw new Error('NavigationProvider is required');
  const parent = useContext(Path);
  const [id] = useState(() => ++nextId);
  const path = useMemo(() => [...parent, id], [parent, id]);
  const latest = useRef(onBack); latest.current = onBack;
  useEffect(() => {
    if (enabled) return store.register({ id, path, task, back: () => latest.current() });
  }, [store, id, path, task, enabled]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { active: enabled && state.top === id, path };
}

export function NavigationScope({ path, children }: PropsWithChildren<{ path: readonly number[] }>) {
  return <Path.Provider value={path}>{children}</Path.Provider>;
}

export function PageLayer({ children }: PropsWithChildren) {
  // All pages share the app's window, keyboard controller and sheet provider.
  // A native Modal here would put the root sheet portal behind the new window.
  return <View style={StyleSheet.absoluteFill}>{children}</View>;
}
