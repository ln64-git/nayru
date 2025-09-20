// DynamicServerApp.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { DynamicServerApp } from "../core/app";

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
    expect(state).toMatchObject({ message: "initial" });
    expect("schema" in state).toBe(false);
    // Note: port is excluded from state by default unless explicitly set
  });

  it("applyStateUpdate updates state", () => {
    app.applyStateUpdate({ message: "updated" });
    expect(app.message).toBe("updated");
  });

  it("getState excludes internal properties", () => {
    const state = app.getState();
    expect(state).not.toHaveProperty("schema");
    expect(state).not.toHaveProperty("isServerInstance");
    expect(state).not.toHaveProperty("logPrefix");
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

  it("setState calls fetch with correct parameters", async () => {
    const body = { message: "new" };
    (fetch as any).mockResolvedValue({ ok: true, json: () => ({ state: body }) });
    const result = await app.setState(body);
    expect(fetch).toHaveBeenCalledWith(`http://localhost:1234/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(result).toEqual(body);
  });

  it("applyStateUpdate ignores non-schema keys", () => {
    app.applyStateUpdate({ message: "hello", fakeKey: 42 } as any);
    expect(app.message).toBe("hello");
    expect((app as any).fakeKey).toBeUndefined();
  });

  it("applyStateUpdate updates properties that exist on the instance", () => {
    // The current implementation updates properties that exist on the instance
    expect(() => {
      app.applyStateUpdate({ port: "oops" } as any);
    }).not.toThrow();
    // The value gets updated even if it's the wrong type
    expect(app.port).toBe("oops");
  });

  it("getState does not include methods", () => {
    const state = app.getState();
    expect(state).not.toHaveProperty("sampleMethod");
  });

  it("probe times out if server does not respond", async () => {
    global.fetch = Object.assign(
      vi.fn(() => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException()), 15))),
      { preconnect: vi.fn() }
    );
    const result = await app.probe(10);
    expect(result).toBe(false);
  });

  it("setState applies state locally when fetch fails", async () => {
    global.fetch = Object.assign(
      vi.fn().mockRejectedValueOnce(new Error("network error")),
      { preconnect: vi.fn() }
    );
    const result = await app.setState({ message: "fail" });
    // When fetch fails, setState applies the state locally and returns the current state
    expect(result).toMatchObject({ message: "fail" });
    expect(app.message).toBe("fail");
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
