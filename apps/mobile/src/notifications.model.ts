export type InboxNotification = {
  id: number; reportId: string; tagName: string; senderName: string | null;
  finder: boolean; body: string; createdAt: string; read: boolean;
};
export type NotificationInbox = { notifications: InboxNotification[]; unreadCount: number; latestId: number; nextCursor: number | null };
export type NotificationTarget = { messageId: number; reportId: string; userId: string; finder: boolean; apiOrigin: string };

export function notificationTarget(data: Record<string, unknown>, userId: string, apiOrigin: string): NotificationTarget | null {
  if (data.userId !== userId || data.apiOrigin !== apiOrigin || typeof data.reportId !== 'string'
    || !/^[A-Za-z0-9_-]{1,100}$/.test(data.reportId) || typeof data.finder !== 'boolean'
    || !Number.isSafeInteger(data.messageId) || Number(data.messageId) < 1) return null;
  return data as NotificationTarget;
}

export function newNotifications(items: InboxNotification[], after: number, activeReport?: string) {
  return items.filter(item => item.id > after && !item.read && item.reportId !== activeReport);
}
