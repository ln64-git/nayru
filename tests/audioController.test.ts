import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("node-mpv", () => {
  return {
    __esModule: true,
    default: class extends EventEmitter {
      load = vi.fn();
      pause = vi.fn();
      resume = vi.fn();
      stop = vi.fn();
    },
  };
});

vi.mock("../src/utils/azure.ts", () => ({
  azureTTS: vi.fn(async () => Buffer.from("test")),
}));

import { AudioController } from "../src/utils/AudioController.ts";

describe("AudioController", () => {
  let controller: AudioController;
  let mpv: any;

  beforeEach(() => {
    controller = new AudioController();
    mpv = (controller as any).mpv;
    (mpv.load as any).mockClear();
  });

  it("loads next file when stopped event emitted", async () => {
    await controller.add("one");
    await controller.add("two");
    (mpv.load as any).mockClear();

    mpv.emit("stopped");
    await new Promise(r => setTimeout(r, 0));

    expect(mpv.load).toHaveBeenCalledWith((controller as any).playlist[1]);
  });
});
