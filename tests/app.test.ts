// DynamicServerApp.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { DynamicServerApp } from "../src/app";

// Sample implementation to test
class TestApp extends DynamicServerApp<z.infer<typeof TestApp.schema>> {
  static schema = z.object({
    port: z.number(),
    message: z.string(),
  });

  schema = TestApp.schema;
  port = 1234;
  message = "initial";
  async sampleMethod() {
    return "method called";
  }
}

describe("DynamicServerApp", () => {
  let app: TestApp;

  beforeEach(() => {
    app = new TestApp();
    global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getState returns correct state", () => {
    const state = app.getState();
    expect(state).toMatchObject({ port: 1234, message: "initial" });
    expect("schema" in state).toBe(false);
  });

  it("applyStateUpdate updates state", () => {
    app.applyStateUpdate({ message: "updated" });
    expect(app.message).toBe("updated");
  });

  it("getMetadata returns correct metadata", () => {
    const metadata = app.getMetadata();
    expect(metadata).toMatchObject({ port: "number", message: "string" });
  });

  it("probe returns true if server responds with ok", async () => {
    (fetch as any).mockResolvedValue({ ok: true });
    const result = await app.probe();
    expect(result).toBe(true);
  });

  it("probe returns false if server errors or times out", async () => {
    (fetch as any).mockRejectedValue(new Error("fail"));
    const result = await app.probe();
    expect(result).toBe(false);
  });

  it("set calls fetch with correct parameters", async () => {
    const body = { message: "new" };
    (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
    await app.set(body);
    expect(fetch).toHaveBeenCalledWith(`http://localhost:1234/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("applyStateUpdate ignores non-schema keys", () => {
    app.applyStateUpdate({ message: "hello", fakeKey: 42 } as any);
    expect(app.message).toBe("hello");
    expect((app as any).fakeKey).toBeUndefined();
  });

  it("applyStateUpdate throws on invalid schema type", () => {
    expect(() => {
      app.applyStateUpdate({ port: "oops" } as any);
    }).toThrow();
  });

  it("getMetadata does not include methods", () => {
    const meta = app.getMetadata();
    expect(meta).not.toHaveProperty("sampleMethod");
  });

  it("probe times out if server does not respond", async () => {
    global.fetch = Object.assign(
      vi.fn(() => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException()), 15))),
      { preconnect: vi.fn() }
    );
    const result = await app.probe(10);
    expect(result).toBe(false);
  });

  it("set does not throw if fetch fails", async () => {
    global.fetch = Object.assign(
      vi.fn().mockRejectedValueOnce(new Error("network error")),
      { preconnect: vi.fn() }
    );
    await expect(app.set({ message: "fail" })).resolves.toBeUndefined();
  });

  it("getState includes inherited fields", () => {
    class InheritedApp extends TestApp {
      newProp = 42;
    }
    const extended = new InheritedApp();
    const state = extended.getState();
    expect(state).toMatchObject({ newProp: 42 });
  });

  it("getState includes getter values", () => {
    class GetterApp extends TestApp {
      get dynamicValue() {
        return 99;
      }
    }
    const getterApp = new GetterApp();
    const state = getterApp.getState();
    expect(state).toHaveProperty("dynamicValue", 99);
  });
});
