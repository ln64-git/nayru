import { env } from "process";

const API_ENDPOINT = (region: string) =>
  `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

export async function azureTTS(
  text: string,
  options: {
    subscriptionKey?: string;
    region?: string;
    voiceGender?: "Male" | "Female";
    voiceName?: string;
  } = {}
): Promise<Buffer> {
  const {
    subscriptionKey = env.AZURE_SUBSCRIPTION_KEY!,
    region = env.AZURE_REGION!,
    voiceGender = env.VOICE_GENDER!,
    voiceName = env.VOICE_NAME!,
  } = options;

  const ssml = generateSSML(text, voiceGender, voiceName);
  const response = await fetch(API_ENDPOINT(region), {
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

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function generateSSML(text: string, gender: string, name: string): string {
  return `
    <speak version='1.0' xml:lang='en-US'>
      <voice xml:lang='en-US' xml:gender='${gender}' name='${name}'>
        ${escapeXml(text)}
      </voice>
    </speak>
  `.trim();
}

function escapeXml(unsafe: string): string {
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
