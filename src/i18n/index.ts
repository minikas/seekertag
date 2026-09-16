import { catalog } from './catalog.ts';
import { errors } from './errors.ts';
import type { Language } from '../preferences.model.ts';

export type Translate = (message: string, values?: Record<string, string | number>) => string;
export function translate(language: Language, message: string, values: Record<string, string | number> = {}): string {
  const translated = language === 'pt' ? message : (catalog[message] || errors[message])?.[language === 'en' ? 0 : 1] || message;
  return translated.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
}
export const createTranslator = (language: Language): Translate => (message, values) => translate(language, message, values);
export function objectCount(t: Translate, count: number, locale: string): string {
  return t(count === 1 ? '{count} objeto' : '{count} objetos', { count: count.toLocaleString(locale) });
}
export function conversationCount(t: Translate, count: number, locale: string): string {
  return t(count === 1 ? '{count} conversa em aberto' : '{count} conversas em aberto', { count: count.toLocaleString(locale) });
}

// API validation messages have bounded, server-generated fields and limits.
export function translateNotice(t: Translate, message: string): string {
  const limits = /^(.+): use entre (\d+) e (\d+) caracteres\.$/.exec(message);
  if (limits) return t('{field}: use entre {min} e {max} caracteres.', { field: t(limits[1]), min: limits[2], max: limits[3] });
  const invalid = /^(.+): informe um texto válido\.$/.exec(message);
  if (invalid) return t('{field}: informe um texto válido.', { field: t(invalid[1]) });
  return t(message);
}
