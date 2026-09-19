import type { Tag } from './api.ts';
import { tagCategoryLabel } from './category.model.ts';
import type { Translate } from './i18n/index.ts';
import { displayTagStatus, type TagStatus } from './tag-status.model.ts';

export type TagFilter = 'all' | TagStatus;
export const matchesTagFilter = (tag: Tag, filter: TagFilter) => filter === 'all'
  ? tag.status !== 'paused'
  : displayTagStatus(tag) === filter;
const normalize = (value: string, locale: string) => value.toLocaleLowerCase(locale).normalize('NFD').replace(/\p{M}/gu, '');

export function searchTags(tags: Tag[], query: string, filter: TagFilter, t: Translate, locale: string): Tag[] {
  const words = normalize(query, locale).trim().split(/\s+/u).filter(Boolean);
  return tags.filter(tag => {
    if (!matchesTagFilter(tag, filter)) return false;
    const text = normalize(`${tag.name} ${tagCategoryLabel(tag, t)}`, locale);
    return words.every(word => text.includes(word));
  });
}
