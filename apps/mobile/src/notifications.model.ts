export type InboxNotification = {
  id: number; reportId: string; tagName: string; senderName: string | null;
  finder: boolean; body: string; createdAt: string; read: boolean;
};
export type NotificationInbox = { notifications: InboxNotification[]; unreadCount: number; latestId: number; nextCursor: number | null };
export type NotificationTarget = { messageId: number; reportId: string; userId: string; finder: boolean; apiOrigin: string };

export function notificationTarget(payload: Record<string, unknown>, userId: string, apiOrigin: string): NotificationTarget | null {
  let data = payload;
  // Expo normally parses FCM's JSON body. Also accept the raw transport form
  // Android can expose for a notification that launched a stopped process.
  if (!('reportId' in data)) {
    const body = data.dataString ?? data.body;
    if (typeof body !== 'string') return null;
    try {
      const decoded: unknown = JSON.parse(body);
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
      data = decoded as Record<string, unknown>;
    } catch { return null; }
  }
  const finder = data.finder === true || data.finder === 'true' ? true : data.finder === false || data.finder === 'false' ? false : undefined;
  const messageId = typeof data.messageId === 'string' && /^[1-9]\d*$/.test(data.messageId) ? Number(data.messageId) : data.messageId;
  if (data.userId !== userId || data.apiOrigin !== apiOrigin || typeof data.reportId !== 'string'
    || !/^[A-Za-z0-9_-]{1,100}$/.test(data.reportId) || finder === undefined
    || typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId < 1) return null;
  return { messageId, reportId: data.reportId, userId, finder, apiOrigin };
}

export function notificationInbox(pages: NotificationInbox[]): NotificationInbox {
  const first = pages[0];
  if (!first) return { notifications: [], unreadCount: 0, latestId: 0, nextCursor: null };
  const seen = new Set<number>();
  return { ...first, nextCursor: pages.at(-1)?.nextCursor ?? null, notifications: pages.flatMap(page => page.notifications).filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id); return true;
  }) };
}

export function updateReadNotifications(pages: NotificationInbox[], fresh: NotificationInbox, throughId: number, reportId?: string): NotificationInbox[] {
  return [fresh, ...pages.slice(1).map(page => ({ ...page, notifications: page.notifications.map(item =>
    item.id <= throughId && (!reportId || item.reportId === reportId) ? { ...item, read: true } : item) }))];
}

export function newNotifications(items: InboxNotification[], after: number, activeReport?: string) {
  return items.filter(item => item.id > after && !item.read && item.reportId !== activeReport);
}
