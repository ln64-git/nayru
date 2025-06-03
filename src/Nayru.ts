import { z } from "zod";
import { DynamicServerApp } from "./app";
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { azureTTS } from "./utils/azure";

export const NayruSchema = z.object({
  port: z.number(),
});

export type NayruState = z.infer<typeof NayruSchema>;

export class Nayru extends DynamicServerApp<NayruState> {
  schema = NayruSchema;
  port = 2003;

  private textQueue: string[] = [];
  private isSpeaking = false;

  async speak(text: string): Promise<void> {
    this.textQueue.push(text);
    if (!this.isSpeaking) this.playNext();
  }

  private async playNext(): Promise<void> {
    if (this.textQueue.length === 0) {
      this.isSpeaking = false;
      return;
    }
    this.isSpeaking = true;
    const nextText = this.textQueue.shift()!;
    const audioPath = await speakWithAzure(nextText); // returns path to .wav or .mp3
    console.log(`🎵 Playing audio for: ${nextText}`);
    await playAudio(audioPath); // blocks until done
    this.playNext(); // recurse to next in queue
  }

  async clearQueue(): Promise<void> {
    this.textQueue = [];
    this.isSpeaking = false;
    console.log("🧹 Cleared text queue.");
  }
}

export async function speakWithAzure(text: string): Promise<string> {
  console.log(`🔊 Speaking: ${text}`);
  const audioBuffer = await azureTTS(text);
  const outputPath = join("/tmp", `${randomUUID()}.wav`);
  writeFileSync(outputPath, audioBuffer);
  return outputPath;
}

export function playAudio(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("mpv", ["--no-terminal", filePath]);
    proc.on("close", resolve);
    proc.on("error", reject);
  });
}
