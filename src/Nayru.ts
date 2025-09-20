import { z } from "zod";
import { AudioController } from "./utils/AudioController";
import { DynamicServerApp } from "../core/app";
import { AzureTTS } from "./providers/azure";
import type { TTSProvider } from "./providers/tts-provider";
import { GoogleTTS } from "./providers/google";

export const NayruSchema = z.object({
  port: z.number(),
});
export type NayruState = z.infer<typeof NayruSchema>;

export class Nayru extends DynamicServerApp<NayruState> {
  schema = NayruSchema;
  port = 2003;

  private audio = new AudioController(getProvider());

  constructor() {
    super();
  }

  async speak(text: string): Promise<void> {
    try {
      await this.audio.add(text);
    } catch (error) {
      console.error(`🔊 [Nayru] Error in speak: ${error}`);
      throw error;
    }
  }

  async speakClipboard(): Promise<void> {
    if (process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE === "wayland") {
      const { execSync } = await import("node:child_process");
      try {
        const hyprClipboard = execSync("wl-paste --no-newline", { encoding: "utf8" });
        if (hyprClipboard) {
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

  async defaultFunction() {
    return await this.speakClipboard();
  }

}


function getProvider(): TTSProvider {
  const provider = process.env.TTS_PROVIDER;

  switch (provider) {
    // case "elevenlabs": return new ElevenLabsTTS();
    case "google":
      return new GoogleTTS();
    case "azure":
      return new AzureTTS();
    case "mock":
      return new MockTTS();
    default:
      // Use mock provider for testing when no API keys are available
      return new MockTTS();
  }
}

// Mock TTS provider for testing
class MockTTS implements TTSProvider {
  name = "Mock";
  async speak(text: string): Promise<Buffer> {
    // Return a small mock audio buffer
    return Buffer.from(`mock audio for: ${text}`);
  }
}
