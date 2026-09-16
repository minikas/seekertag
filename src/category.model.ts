import type { Category, Tag } from './api.ts';
import type { Translate } from './i18n/index.ts';

const presetNames: Record<string, string> = { backpack: 'Mochila', luggage: 'Mala', keys: 'Chaves', pet: 'Pet', electronics: 'Eletrônico', other: 'Outro' };
export const categoryLabel = (category: Pick<Category, 'name' | 'defaultKey'>, t: Translate) => category.defaultKey && presetNames[category.defaultKey] ? t(presetNames[category.defaultKey]) : category.name;
export const tagCategoryLabel = (tag: Pick<Tag, 'category' | 'categoryDefaultKey'>, t: Translate) => categoryLabel({ name: tag.category, defaultKey: tag.categoryDefaultKey }, t);
export function categoryInk(color: string) {
  const rgb = color.slice(1).match(/.{2}/g)?.map(v => parseInt(v, 16)) || [0, 0, 0];
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 155 ? '#10221D' : '#FFFFFF';
}
