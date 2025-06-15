export interface TTSProvider {
  name: string;
  speak(text: string): Promise<Buffer>;
}
