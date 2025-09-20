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
      if (!this.playing) {
        this.playNext();
      }
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

    // Check if file exists before trying to play it
    if (!existsSync(file)) {
      console.error(`🔊 [AudioController] File does not exist: ${file}`);
      this.playing = false;
      // Try to play next item in queue
      this.playNext();
      return;
    }

    this.currentFile = file;
    this.playing = true;

    try {
      this.mpvProcess = spawn("aplay", [file]);

      // Set a timeout to kill the process if it doesn't finish
      const timeout = setTimeout(() => {
        if (this.mpvProcess && !this.mpvProcess.killed) {
          console.log(`🔊 [AudioController] Audio timeout, killing process`);
          this.mpvProcess.kill('SIGTERM');
        }
      }, 15000); // 15 second timeout

      this.mpvProcess.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`🔊 [AudioController] Audio process closed with code: ${code}`);
        // Clean up file when audio actually finishes
        if (existsSync(file)) {
          try {
            unlinkSync(file);
          } catch (err) {
            console.warn(`Failed to delete audio file: ${err}`);
          }
        }
        this.history.push(file);
        this.playing = false;
        this.mpvProcess = null;
        // Continue with next item in queue
        this.playNext();
      });

      this.mpvProcess.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`🔊 [AudioController] Audio error: ${err}`);
        this.playing = false;
        this.mpvProcess = null;
        // Still clean up the file even on error
        if (existsSync(file)) {
          try {
            unlinkSync(file);
          } catch (cleanupErr) {
            console.warn(`Failed to delete audio file after error: ${cleanupErr}`);
          }
        }
        // Try to play next item in queue even on error
        this.playNext();
      });

      // Handle process exit to prevent server crashes
      this.mpvProcess.on('exit', (code, signal) => {
        clearTimeout(timeout);
        this.playing = false;
        this.mpvProcess = null;
        // Continue with next item in queue
        this.playNext();
      });

    } catch (error) {
      console.error(`🔊 [AudioController] Failed to spawn audio player: ${error}`);
      this.playing = false;
      this.mpvProcess = null;
      // Try to play next item in queue
      this.playNext();
    }
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
