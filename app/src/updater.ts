import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Desktop app only. Ask GitHub whether a newer version exists and, if so, offer
 * to install it and restart. In the web build (or offline, or before any update
 * release exists) check() throws and we quietly do nothing.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    const ok = window.confirm(`Timeblock ${update.version} is available. Update now? The app will restart.`);
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch {
    // Not the desktop app, offline, or no update release yet. Ignore.
  }
}
