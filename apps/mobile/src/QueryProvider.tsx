import React, { PropsWithChildren, useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './query-cache';

export default function QueryProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active');
    const appState = AppState.addEventListener('change', state => focusManager.setFocused(state === 'active'));
    const unsubscribe = NetInfo.addEventListener(state => {
      onlineManager.setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return () => { appState.remove(); unsubscribe(); };
  }, []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
