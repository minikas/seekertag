import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Screen from './Screen';
import Pressable from './HapticPressable';
import { usePreferences } from './PreferencesProvider';
import { LanguagePreference, ThemePreference } from './preferences.model';
import { Icon, Notice, Sheet, useUI } from './ui';

export default function PreferencesScreen({ section, onClose, presentation = 'modal' }: { presentation?: 'screen' | 'modal'; section: 'language' | 'theme'; onClose: () => void }) {
  const { C, s, t, locale } = useUI();
  const Frame = presentation === 'screen' ? Screen : Sheet;
  const { preferences, update } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const languages: { value: LanguagePreference; title: string; subtitle?: string }[] = [
    { value: 'system', title: t("Igual ao dispositivo"), subtitle: t("Usa o idioma do seu aparelho") },
    { value: 'pt', title: 'Português', subtitle: 'Brasil' }, { value: 'en', title: 'English' }, { value: 'es', title: 'Español' },
  ];
  const themes: { value: ThemePreference; title: string; subtitle?: string }[] = [
    { value: 'system', title: t("Igual ao dispositivo"), subtitle: t("Usa a aparência do seu aparelho") },
    { value: 'light', title: t("Claro") }, { value: 'dark', title: t("Escuro") },
  ];
  async function choose(value: LanguagePreference | ThemePreference) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await update(section === 'language' ? { language: value as LanguagePreference } : { theme: value as ThemePreference });
    } catch { setError('Não foi possível salvar a preferência. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <Frame title={section === 'language' ? t("Idioma") : t("Aparência")} onClose={onClose}>
    <View>{(section === 'language' ? languages : themes).map(option => {
      const selected = preferences[section] === option.value;
      return <Pressable key={option.value} testID={`preference-${section}-${option.value}`} accessibilityRole="radio" accessibilityLabel={t(option.title)} accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => void choose(option.value)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 26, borderBottomWidth: 1, borderBottomColor: C.line, opacity: pressed ? 0.6 : 1 })}>
        <View style={s.settingsIcon}><Icon name={section === 'language' ? 'globe' : 'sliders'} size={20} /></View>
        <View style={{ flex: 1, gap: 6 }}><Text style={s.h3}>{t(option.title)}</Text>{!!option.subtitle && <Text style={s.small}>{t(option.subtitle)}</Text>}</View>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: selected ? C.primary : 'transparent', borderWidth: selected ? 0 : 1, borderColor: C.raised, alignItems: 'center', justifyContent: 'center' }}>{selected && <Icon name="check" size={18} color={C.onPrimary} />}</View>
      </Pressable>;
    })}</View>
    {!!error && <Notice error text={error} />}
  </Frame>;
}
