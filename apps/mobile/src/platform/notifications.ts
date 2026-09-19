import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from '../api';

export { Notifications };
export const firebaseProjectId = Constants.expoConfig?.extra?.firebaseProjectId as string | undefined;
export async function prepareNotifications(request = false) {
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'SeekerTag', importance: Notifications.AndroidImportance.HIGH,
    sound: 'default', vibrationPattern: [0, 200, 100, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (request && !permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  return permission;
}

const registrationLifetime = 5 * 60 * 1000;
let registered: { key: string; enabled: boolean; expires: number } | undefined;
const pendingRegistrations = new Map<string, Promise<boolean>>();

export async function registerPush(token: string, language: string, deviceToken?: Notifications.DevicePushToken) {
  if (!firebaseProjectId) return false;
  // Android emits the token listener when this getter resolves. Token events
  // must supply their token here instead of calling the getter recursively.
  const push = deviceToken ?? await Notifications.getDevicePushTokenAsync();
  const key = JSON.stringify([token, language, firebaseProjectId, push.type, push.data]);
  if (registered?.key === key && registered.expires > Date.now()) return registered.enabled;
  const pending = pendingRegistrations.get(key);
  if (pending) return pending;
  const registration = api<{ enabled: boolean }>('/notifications/devices', token, {
    token: push.data, language, provider: 'fcm', projectId: firebaseProjectId,
  }).then(result => {
    registered = { key, enabled: result.enabled, expires: Date.now() + registrationLifetime };
    return result.enabled;
  }).finally(() => { pendingRegistrations.delete(key); });
  // Bootstrap and its native token event share one request. Foregrounding also
  // reuses a recent success; failures remain retryable on the next attempt.
  pendingRegistrations.set(key, registration);
  return registration;
}
