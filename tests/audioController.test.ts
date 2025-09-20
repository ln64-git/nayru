import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "child_process";

// Mock the spawn function
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ stdout: "5.0" })), // Mock ffprobe duration
}));

// Mock TTS provider
const mockTTS = {
  name: "Mock",
  async speak(text: string) {
    return Buffer.from(`mock audio for: ${text}`);
  }
};

import { AudioController } from "../src/utils/AudioController.ts";

describe("AudioController", () => {
  let controller: AudioController;
  let mockProcess: any;

  beforeEach(() => {
    // Create a mock process that emits events
    mockProcess = {
      on: vi.fn(),
      kill: vi.fn(),
    };

    (spawn as any).mockReturnValue(mockProcess);

    controller = new AudioController(mockTTS);
  });

  it("adds text to queue and starts playing", async () => {
    await controller.add("test text");

    expect(spawn).toHaveBeenCalledWith("mpv", ["--no-video", "--quiet", expect.any(String)]);
    expect(mockProcess.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(mockProcess.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("clears queue and stops current process", () => {
    // Set up a mock process first
    (controller as any).mpvProcess = mockProcess;

    controller.clear();

    expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("skips current audio", () => {
    // Set up a mock process first
    (controller as any).mpvProcess = mockProcess;

    controller.skip();

    expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
