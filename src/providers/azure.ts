import { env } from "process";
import type { TTSProvider } from "./tts-provider";

export class AzureTTS implements TTSProvider {
  name = "Azure";
  async speak(text: string): Promise<Buffer> {
    const subscriptionKey = env.AZURE_SUBSCRIPTION_KEY!;
    const region = env.AZURE_REGION!;
    const voiceGender = env.VOICE_GENDER!;
    const voiceName = env.VOICE_NAME!;
    const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const ssml = this.generateSSML(text, voiceGender, voiceName);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": subscriptionKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm",
      },
      body: ssml,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Azure TTS error ${response.status}: ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private generateSSML(text: string, gender: string, name: string): string {
    return `
      <speak version='1.0' xml:lang='en-US'>
        <voice xml:lang='en-US' xml:gender='${gender}' name='${name}'>
          ${this.escapeXml(text)}
        </voice>
      </speak>
    `.trim();
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "&": return "&amp;";
        case "'": return "&apos;";
        case `"`: return "&quot;";
        default: return char;
      }
    });
  }
}
