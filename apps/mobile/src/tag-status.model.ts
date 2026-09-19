import type { Tag } from './api.ts';

export type TagStatus = Tag['status'] | 'recovered';

// The API keeps returned tags active so their QR/NFC still works. The owner UI
// distinguishes them from protected items without hiding a later loss/archive.
export function displayTagStatus(tag: Pick<Tag, 'status' | 'recoveryCount'>): TagStatus {
  return tag.status === 'active' && tag.recoveryCount > 0 ? 'recovered' : tag.status;
}
