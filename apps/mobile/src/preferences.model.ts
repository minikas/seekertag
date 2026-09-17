export type Language = 'pt' | 'en' | 'es';
export type LanguagePreference = Language | 'system';
export type ThemePreference = 'system' | 'dark' | 'light';
export type Preferences = { language: LanguagePreference; theme: ThemePreference };
export const defaultPreferences: Preferences = { language: 'system', theme: 'system' };
export function parsePreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw || '{}');
    return {
      language: ['system', 'pt', 'en', 'es'].includes(value?.language) ? value.language : 'system',
      theme: ['system', 'dark', 'light'].includes(value?.theme) ? value.theme : 'system',
    };
  } catch { return { ...defaultPreferences }; }
}
export function resolveLanguage(preference: LanguagePreference, deviceLanguages: (string | null)[]): Language {
  if (preference !== 'system') return preference;
  for (const code of deviceLanguages) {
    const base = code?.toLowerCase().split(/[-_]/)[0];
    if (base === 'pt' || base === 'en' || base === 'es') return base;
  }
  return 'en';
}
export const localeFor = (language: Language) => ({ pt: 'pt-BR', en: 'en-US', es: 'es-ES' })[language];
