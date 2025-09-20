import { spawn, spawnSync, type ChildProcessWithoutNullStreams, } from "child_process";
import { unlinkSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { TTSProvider } from "../providers/tts-provider";

export class AudioController {
  constructor(private tts: TTSProvider) { }

  private queue: string[] = [];
  private history: string[] = [];
  private playing = false;
  private currentFile: string | null = null;
  private mpvProcess: ChildProcessWithoutNullStreams | null = null;

  async add(text: string): Promise<void> {
    try {
      const buffer = await this.tts.speak(text);
      if (!buffer) {
        console.warn('TTS returned empty buffer for text:', text);
        return;
      }

      const filePath = join("/tmp", `${randomUUID()}.wav`);
      writeFileSync(filePath, buffer);
      this.queue.push(filePath);
      if (!this.playing) this.playNext();
    } catch (error) {
      console.error('TTS error:', error);
      throw error; // Re-throw to let caller handle
    }
  }

  private playNext(): void {
    const file = this.queue.shift();
    if (!file) {
      this.playing = false;
      return;
    }

    this.currentFile = file;
    this.playing = true;

    this.mpvProcess = spawn("mpv", ["--no-video", "--quiet", file]);

    this.mpvProcess.on('close', (code) => {
      // Clean up file when audio actually finishes
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch (err) {
          console.warn(`Failed to delete audio file: ${err}`);
        }
      }
      this.history.push(file);
      this.playNext();
    });

    this.mpvProcess.on('error', (err) => {
      console.error(`MPV error: ${err}`);
      this.playing = false;
      // Still clean up the file even on error
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch (cleanupErr) {
          console.warn(`Failed to delete audio file after error: ${cleanupErr}`);
        }
      }
    });
  }

  skip(): void {
    if (this.mpvProcess) {
      this.mpvProcess.kill('SIGTERM');
      this.mpvProcess = null;
    }
  }

  goBack(): void {
    if (this.history.length === 0) return;

    const previousFile = this.history.pop()!;
    if (existsSync(previousFile)) {
      this.queue.unshift(previousFile); // requeue at the front
    }
    this.skip();
  }

  clear(): void {
    // Kill mpv process first to prevent zombie processes
    if (this.mpvProcess) {
      this.mpvProcess.kill('SIGTERM');
      this.mpvProcess = null;
    }

    // Clean up queued files
    this.queue.forEach(f => {
      if (existsSync(f)) {
        try {
          unlinkSync(f);
        } catch (err) {
          console.warn(`Failed to delete queued audio file: ${err}`);
        }
      }
    });
    this.queue = [];

    // Clean up current file
    if (this.currentFile && existsSync(this.currentFile)) {
      try {
        unlinkSync(this.currentFile);
      } catch (err) {
        console.warn(`Failed to delete current audio file: ${err}`);
      }
    }
    this.currentFile = null;

    // Reset state
    this.playing = false;
    this.history = [];
  }
}
