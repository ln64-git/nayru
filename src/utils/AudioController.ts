import { spawnSync, spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { azureTTS } from "./azure";

export class AudioController {
  private queue: string[] = [];
  private playing = false;

  async add(text: string): Promise<void> {
    const buffer = await azureTTS(text);
    if (!buffer) return;
    const filePath = join("/tmp", `${randomUUID()}.wav`);
    writeFileSync(filePath, buffer);
    this.queue.push(filePath);
    if (!this.playing) this.playNext();
  }

  private getDuration(file: string): number {
    const result = spawnSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file
    ], { encoding: "utf-8" });
    return parseFloat(result.stdout) || 0;
  }

  private playNext(): void {
    const file = this.queue.shift();
    if (!file) {
      this.playing = false;
      return;
    }
    this.playing = true;
    const duration = this.getDuration(file);
    const mpv = spawn("mpv", ["--no-video", "--quiet", file]);
    setTimeout(() => {
      mpv.kill();
      unlinkSync(file);
      this.playNext();
    }, (duration * 1000) + 200);
  }

  clear(): void {
    this.queue.forEach(f => unlinkSync(f));
    this.queue = [];
    this.playing = false;
  }
}
