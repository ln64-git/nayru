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
  async clearAudioQueue() {
    this.audio.clear();
  }
}

