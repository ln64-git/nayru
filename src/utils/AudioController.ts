import { spawn, spawnSync, type ChildProcessWithoutNullStreams, } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { azureTTS } from "./azure";

export class AudioController {
  private queue: string[] = [];
  private history: string[] = [];
  private playing = false;
  private currentFile: string | null = null;
  private mpvProcess: ChildProcessWithoutNullStreams | null = null;

  async add(text: string): Promise<void> {
    const buffer = await azureTTS(text);
    if (!buffer) return;

    const filePath = join("/tmp", `${randomUUID()}.wav`);
    writeFileSync(filePath, buffer);
    this.queue.push(filePath);
    if (!this.playing) this.playNext();
  }

  private playNext(): void {
    const file = this.queue.shift();
    if (!file) {
      this.playing = false;
      return;
    }

    this.currentFile = file;
    this.playing = true;
    const duration = getDuration(file);

    this.mpvProcess = spawn("mpv", ["--no-video", "--quiet", file]);

    setTimeout(() => {
      if (existsSync(file)) unlinkSync(file);
      this.history.push(file);
      this.playNext();
    }, (duration * 1000) + 200);
  }

  skip(): void {
    if (this.mpvProcess) {
      this.mpvProcess.kill();
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
    this.queue.forEach(f => existsSync(f) && unlinkSync(f));
    this.queue = [];
    this.playing = false;
    if (this.currentFile && existsSync(this.currentFile)) {
      unlinkSync(this.currentFile);
    }
    this.currentFile = null;
    this.history = [];
    if (this.mpvProcess) {
      this.mpvProcess.kill();
    }
  }
}


function getDuration(file: string): number {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file
  ], { encoding: "utf-8" });
  return parseFloat(result.stdout) || 0;
}
