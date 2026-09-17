import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { useLocales } from 'expo-localization';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';
import { secureStorage } from './platform/storage';
import { defaultPreferences, localeFor, parsePreferences, Preferences, resolveLanguage } from './preferences.model';
import { Colors, darkColors, lightColors } from './theme';

type Value = { preferences: Preferences; language: 'pt' | 'en' | 'es'; locale: string; dark: boolean; colors: Colors; update: (changes: Partial<Preferences>) => Promise<void> };
const Context = createContext<Value | null>(null);
export function PreferencesProvider({ children }: PropsWithChildren) {
  const systemTheme = useColorScheme();
  const locales = useLocales();
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void secureStorage.get('preferences-v1').then(raw => { if (active) setPreferences(parsePreferences(raw)); })
      .catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const language = resolveLanguage(preferences.language, locales.map(l => l.languageCode));
  const dark = preferences.theme === 'system' ? systemTheme === 'dark' : preferences.theme === 'dark';
  const colors = dark ? darkColors : lightColors;
  const update = useCallback(async (changes: Partial<Preferences>) => {
    const next = { ...preferences, ...changes };
    // Apply only after persistence succeeds, so a failed save never looks saved.
    await secureStorage.set('preferences-v1', JSON.stringify(next));
    setPreferences(next);
  }, [preferences]);
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
    NavigationBar.setStyle(dark ? 'light' : 'dark');
  }, [colors, dark]);
  const value = useMemo(() => ({ preferences, language, locale: localeFor(language), dark, colors, update }), [preferences, language, dark, colors, update]);
  return <Context.Provider value={value}>{ready ? children : <View style={{ flex: 1, backgroundColor: colors.bg }} />}</Context.Provider>;
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider is required');
  return value;
}
export function useThemedStyles<T>(factory: (colors: Colors) => T): T {
  const { colors } = usePreferences();
  return useMemo(() => factory(colors), [colors, factory]);
}
