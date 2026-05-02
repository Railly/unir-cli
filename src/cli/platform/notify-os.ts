// cligentic block: notify-os
//
// Fires a system notification across macOS, Linux, Windows, and WSL.
// Returns a typed verdict instead of throwing.
//
// Usage:
//   import { notifyOs } from "./platform/notify-os";
//
//   const result = await notifyOs("Deploy complete", "myapp v1.2.0 is live");

import { execSync } from "node:child_process";
import { platform } from "node:os";
import { hasCommand, isCi, isWsl } from "./detect";

export type NotifyResult = {
  sent: boolean;
  via: "osascript" | "notify-send" | "powershell" | "skipped";
  reason?: string;
};

export type NotifyOptions = {
  dryRun?: boolean;
  appName?: string;
  sound?: boolean;
};

function escapeOsascript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function notifyOs(
  title: string,
  message: string,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const { dryRun = false, appName = "CLI", sound = true } = options;

  if (isCi()) return { sent: false, via: "skipped", reason: "CI environment" };

  const os = platform();

  if (os === "darwin") {
    const soundClause = sound ? ' sound name "default"' : "";
    const cmd = `osascript -e 'display notification "${escapeOsascript(message)}" with title "${escapeOsascript(title)}"${soundClause}'`;
    if (dryRun) return { sent: true, via: "osascript", reason: `would run: ${cmd}` };
    try {
      execSync(cmd, { stdio: "ignore", timeout: 5000 });
      return { sent: true, via: "osascript" };
    } catch (err) {
      return { sent: false, via: "osascript", reason: (err as Error).message };
    }
  }

  if (os === "win32" || isWsl()) {
    const psCmd = `powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}', 'Info')"`;
    if (dryRun) return { sent: true, via: "powershell", reason: "would run: PowerShell notification" };
    try {
      execSync(psCmd, { stdio: "ignore", timeout: 10000 });
      return { sent: true, via: "powershell" };
    } catch (err) {
      return { sent: false, via: "powershell", reason: (err as Error).message };
    }
  }

  if (hasCommand("notify-send")) {
    const cmd = `notify-send --app-name="${appName}" "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`;
    if (dryRun) return { sent: true, via: "notify-send", reason: `would run: ${cmd}` };
    try {
      execSync(cmd, { stdio: "ignore", timeout: 5000 });
      return { sent: true, via: "notify-send" };
    } catch (err) {
      return { sent: false, via: "notify-send", reason: (err as Error).message };
    }
  }

  return { sent: false, via: "skipped", reason: "no notification backend found" };
}
