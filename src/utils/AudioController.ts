import MPV from "node-mpv";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { azureTTS } from "./azure";

export class AudioController {
  private mpv: any;
  private playlist: string[] = [];
  private currentIndex = 0;
  private isPlaying = false;

  constructor() {
    this.mpv = new MPV({ audio_only: true, auto_restart: true });

    this.mpv.on("stopped", async () => {
      console.log("📴 mpv stopped");
      const currentFile = this.playlist[this.currentIndex];
      try {
        if (currentFile) {
          unlinkSync(currentFile);
          console.log("🗑️ Deleted file:", currentFile);
        }
      } catch (err) {
        console.error("⚠️ Failed to clean file:", err);
      }

      this.currentIndex++;
      if (this.currentIndex < this.playlist.length) {
        console.log("▶️ Continuing to next index:", this.currentIndex);
        try {
          await this.mpv.load(this.playlist[this.currentIndex]);
          this.isPlaying = true;
        } catch (err) {
          console.error("❌ Failed to load next track:", err);
          this.isPlaying = false;
        }
      } else {
        this.isPlaying = false;
        console.log("🏁 Queue finished");
        this.playlist = [];
        this.currentIndex = 0;
      }
    });

    this.mpv.on("started", () => {
      console.log("🔊 mpv started");
    });

    this.mpv.on("statuschange", (status: any) => {
      console.log("📈 Status changed:", status);
    });
  }

  async add(text: string): Promise<void> {
    const buffer = await azureTTS(text);
    const filePath = join("/tmp", `${randomUUID()}.wav`);
    writeFileSync(filePath, buffer);
    console.log("➕ Added to playlist:", filePath);

    const willAutoPlay = !this.isPlaying;
    this.playlist.push(filePath);

    if (willAutoPlay) {
      this.isPlaying = true;
      this.currentIndex = 0;
      try {
        await this.mpv.load(this.playlist[this.currentIndex]);
      } catch (err) {
        console.error("❌ Failed to start playback:", err);
        this.isPlaying = false;
      }
    }
  }

  pause(): void {
    console.log("⏸️ Pausing audio");
    this.mpv.pause();
  }

  resume(): void {
    console.log("▶️ Resuming audio");
    this.mpv.resume();
  }

  stop(): void {
    console.log("⏹ Stopping playback");
    this.mpv.stop();
    this.isPlaying = false;
  }

  next(): void {
    console.log("⏭ Skipping to next");
    if (this.currentIndex + 1 < this.playlist.length) {
      this.currentIndex++;
      this.mpv.load(this.playlist[this.currentIndex]);
    }
  }

  back(): void {
    console.log("⏮ Going back");
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.mpv.load(this.playlist[this.currentIndex]);
    }
  }

  clear(): void {
    console.log("🧹 Clearing queue");
    this.stop();
    this.playlist = [];
    this.currentIndex = 0;
  }
}