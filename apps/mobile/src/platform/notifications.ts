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

export async function registerPush(token: string, language: string) {
  if (!firebaseProjectId) return false;
  const push = await Notifications.getDevicePushTokenAsync();
  const result = await api<{ enabled: boolean }>('/notifications/devices', token, {
    token: push.data, language, provider: 'fcm', projectId: firebaseProjectId,
  });
  return result.enabled;
}
