// cligentic block: copy-clipboard
//
// Copies text to the system clipboard across macOS, Linux (X11 + Wayland),
// Windows, and WSL. Returns a typed verdict instead of throwing.
//
// Usage:
//   import { copyToClipboard } from "./platform/copy-clipboard";
//
//   const result = await copyToClipboard("https://cligentic.railly.dev");
//   if (!result.copied) {
//     console.log("Copy this manually:", text);
//   }

import { execSync } from "node:child_process";
import { platform } from "node:os";
import { hasCommand, isWsl } from "./detect";

export type CopyResult = {
  copied: boolean;
  via: "pbcopy" | "xclip" | "xsel" | "wl-copy" | "clip.exe" | "powershell" | "manual";
  reason?: string;
};

export type CopyOptions = {
  dryRun?: boolean;
};

function tryExec(cmd: string, text: string): boolean {
  try {
    execSync(cmd, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function copyToClipboard(
  text: string,
  options: CopyOptions = {},
): Promise<CopyResult> {
  const { dryRun = false } = options;
  const os = platform();

  if (os === "darwin") {
    if (dryRun) return { copied: true, via: "pbcopy", reason: "would run: pbcopy" };
    if (tryExec("pbcopy", text)) return { copied: true, via: "pbcopy" };
    return { copied: false, via: "manual", reason: "pbcopy failed" };
  }

  if (os === "win32") {
    if (dryRun) return { copied: true, via: "powershell", reason: "would run: Set-Clipboard" };
    if (tryExec('powershell.exe -NoProfile -Command "Set-Clipboard -Value $input"', text)) {
      return { copied: true, via: "powershell" };
    }
    return { copied: false, via: "manual", reason: "powershell Set-Clipboard failed" };
  }

  if (os === "linux" && isWsl()) {
    if (hasCommand("clip.exe")) {
      if (dryRun) return { copied: true, via: "clip.exe", reason: "would run: clip.exe" };
      if (tryExec("clip.exe", text)) return { copied: true, via: "clip.exe" };
    }
    return { copied: false, via: "manual", reason: "WSL without clip.exe" };
  }

  // Linux: Wayland first, then X11
  if (process.env.WAYLAND_DISPLAY && hasCommand("wl-copy")) {
    if (dryRun) return { copied: true, via: "wl-copy", reason: "would run: wl-copy" };
    if (tryExec("wl-copy", text)) return { copied: true, via: "wl-copy" };
  }

  if (process.env.DISPLAY) {
    if (hasCommand("xclip")) {
      if (dryRun) return { copied: true, via: "xclip", reason: "would run: xclip" };
      if (tryExec("xclip -selection clipboard", text)) return { copied: true, via: "xclip" };
    }
    if (hasCommand("xsel")) {
      if (dryRun) return { copied: true, via: "xsel", reason: "would run: xsel" };
      if (tryExec("xsel --clipboard --input", text)) return { copied: true, via: "xsel" };
    }
  }

  return { copied: false, via: "manual", reason: "no clipboard backend found" };
}
