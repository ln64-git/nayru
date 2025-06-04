import { spawnSync, spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { azureTTS } from "./azure";

export class AudioController {
  private playlist: string[] = [];
  private isPlaying = false;

  async add(text: string): Promise<void> {
    const buffer = await azureTTS(text);
    if (!buffer || buffer.length === 0) {
      console.error("❌ Azure TTS returned empty buffer!");
      return;
    }

    const filePath = join("/tmp", `${randomUUID()}.wav`);
    writeFileSync(filePath, buffer);
    console.log("➕ Added to playlist:", filePath);

    this.playlist.push(filePath);
    if (!this.isPlaying) {
      this.playNext();
    } else {
      console.log("⏳ Playback already active. Queued.");
    }
  }

  private getAudioDuration(filePath: string): number {
    const result = spawnSync("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ], { encoding: "utf-8" });

    if (result.error) {
      console.error("❌ ffprobe execution error:", result.error);
      return 0;
    }

    const duration = parseFloat(result.stdout);
    if (isNaN(duration)) {
      console.error("❌ Invalid duration from ffprobe output:", result.stdout);
      return 0;
    }

    return duration;
  }

  private playNext(): void {
    if (this.playlist.length === 0) {
      console.log("🏁 Playlist completed!");
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const currentFile = this.playlist.shift()!;
    const duration = this.getAudioDuration(currentFile);

    if (duration <= 0) {
      console.error("❌ Invalid audio duration, skipping file:", currentFile);
      this.cleanupFile(currentFile);
      this.playNext(); // Skip invalid file
      return;
    }

    console.log(`▶️ Playing track: ${currentFile} (duration: ${duration}s)`);

    const mpvProcess = spawn("mpv", [
      "--no-video",
      "--quiet",
      "--no-terminal",
      "--idle=no",
      "--force-window=no",
      currentFile
    ]);

    setTimeout(() => {
      console.log(`✅ Playback completed for: ${currentFile}`);
      mpvProcess.kill("SIGTERM");  // Force termination if still alive
      this.cleanupFile(currentFile);
      this.playNext(); // Proceed to next file
    }, duration * 1000 + 200); // Slight buffer of 200ms
  }

  private cleanupFile(filePath: string): void {
    try {
      unlinkSync(filePath);
      console.log("🗑️ Deleted file:", filePath);
    } catch (err) {
      console.error("⚠️ Failed to delete file:", err);
    }
  }

  stop(): void {
    console.log("⏹️ Stopping playback and clearing queue");
    this.playlist.forEach(file => this.cleanupFile(file));
    this.playlist = [];
    this.isPlaying = false;
  }

  clear(): void {
    this.stop();
  }
}
