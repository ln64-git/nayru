import { z } from "zod";
import { DynamicServerApp } from "./app";
import { AudioController } from "./utils/AudioController";

export const NayruSchema = z.object({
  port: z.number(),
});

export type NayruState = z.infer<typeof NayruSchema>;

export class Nayru extends DynamicServerApp<NayruState> {
  schema = NayruSchema;
  port = 2003;

  private audio = new AudioController();

  async speak(text: string): Promise<void> {
    console.log(`💬 Queuing: "${text}"`);
    await this.audio.add(text);
  }

  async speakClipboard(): Promise<void> {
    if (process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE === "wayland") {
      const { execSync } = await import("node:child_process");
      try {
        const hyprClipboard = execSync("wl-paste --no-newline", { encoding: "utf8" });
        if (hyprClipboard) {
          console.log(`💬 Queuing clipboard: "${hyprClipboard}"`);
          await this.audio.add(hyprClipboard);
        } else {
          console.warn("Clipboard is empty.");
        }
      } catch (err) {
        console.warn("Failed to get clipboard from Hyprland (wl-paste not available).");
      }
    }
  }

  async clearAudioQueue() {
    this.audio.clear();
  }

}

