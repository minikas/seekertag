import { api, Report } from './api';
import { createFinderStore } from './finderStore';
import { secureStorage } from './platform/storage';
export type { SavedConversation } from './finderStore';
export const finderConversations = createFinderStore(secureStorage);
export function reportSummary(report: Report) { return { id: report.id, tagCode: report.tagCode, tagName: report.tagName, updatedAt: report.updatedAt, status: report.status }; }
export async function listSavedConversations() {
  // On web the old capability keys can be found. On native, opening a known
  // legacy link calls remember(), because Keychain offers no enumeration API.
  const ids = await finderConversations.legacyIds();
  for (const id of ids) {
    const token = await secureStorage.get(`finder-${id}`);
    if (!token) continue;
    try { const { report } = await api<{ report: Report }>(`/finder/reports/${id}`, token); await finderConversations.remember(reportSummary(report)); }
    catch { /* Keep capabilities intact; a temporary outage is not revocation. */ }
  }
  return finderConversations.list();
}
