import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { fetchWeek } from "./supabase";

// Reminders fire this many minutes before a block starts.
const LEAD_MIN = 5;
// iOS caps pending notifications (~64); stay well under.
const MAX_PENDING = 30;

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      });
    }
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Cancel all scheduled reminders and re-schedule one per upcoming block. Call
 * on app start and after any change to the plan. Local notifications only —
 * no server, works offline.
 */
export async function syncBlockReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  const ok = await ensurePermissions();
  if (!ok) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const blocks = await fetchWeek();
    const now = Date.now();
    const upcoming = blocks
      .filter((b) => b.status === "planned")
      .map((b) => ({ b, fireAt: new Date(b.starts_at).getTime() - LEAD_MIN * 60_000 }))
      .filter((x) => x.fireAt > now + 30_000)
      .sort((a, b) => a.fireAt - b.fireAt)
      .slice(0, MAX_PENDING);

    for (const { b, fireAt } of upcoming) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: b.title,
          body: `Starts in ${LEAD_MIN} minutes`,
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
          channelId: "reminders",
        },
      });
    }
  } catch {
    // Notifications are best-effort (Expo Go has limits); never crash the app.
  }
}
