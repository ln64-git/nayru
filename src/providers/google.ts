// src/utils/GoogleTTSRest.ts
import fetch from "node-fetch";
import type { TTSProvider } from "./tts-provider";

export class GoogleTTS implements TTSProvider {
  name = "Azure";
  private apiKey = process.env.GOOGLE_TTS_API_KEY;
  private endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize`;

  async speak(text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error("Missing GOOGLE_TTS_API_KEY env var");

    const body = {
      input: { text },
      voice: {
        languageCode: process.env.GOOGLE_LANGUAGE_CODE || "en-US",
        name: process.env.GOOGLE_VOICE_NAME || "en-US-Wavenet-D",
      },
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: 48000,
      },
    };

    const url = `${this.endpoint}?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google TTS REST error ${res.status}: ${errText}`);
    }

    const json = await res.json() as { audioContent?: string };
    if (!json.audioContent) {
      throw new Error("Google TTS REST: missing audioContent");
    }

    // Response is base64–encoded audio
    return Buffer.from(json.audioContent, "base64");
  }
}
