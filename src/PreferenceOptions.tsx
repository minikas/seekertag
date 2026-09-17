import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { usePreferences } from './PreferencesProvider';
import { LanguagePreference, ThemePreference } from './preferences.model';
import { Icon, Notice, useUI } from './ui';

export default function PreferenceOptions({ section, onSelected }: { section: 'language' | 'theme'; onSelected: () => void }) {
  const { C, s, t } = useUI();
  const { preferences, update } = usePreferences();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
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
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError('');
    try {
      await update(section === 'language' ? { language: value as LanguagePreference } : { theme: value as ThemePreference });
      onSelected();
    } catch { setError('Não foi possível salvar a preferência. Tente novamente.'); }
    finally { saving.current = false; setBusy(false); }
  }
  const options = section === 'language' ? languages : themes;
  return <>
    <View>{options.map((option) => {
      const selected = preferences[section] === option.value;
      return <Pressable key={option.value} testID={`preference-${section}-${option.value}`} accessibilityRole="radio" accessibilityLabel={t(option.title)} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} onPress={() => void choose(option.value)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, opacity: pressed ? 0.6 : 1 })}>
        <View style={{ width: 24, alignItems: 'center' }}>{selected && <Icon name="check" size={22} color={C.accent} />}</View>
        <View style={{ flex: 1, gap: 6 }}><Text style={{ color: C.ink, fontSize: 18, lineHeight: 26 }}>{t(option.title)}</Text>{!!option.subtitle && <Text style={s.small}>{t(option.subtitle)}</Text>}</View>

      </Pressable>;
    })}</View>
    {!!error && <Notice error text={error} />}
  </>;
}
