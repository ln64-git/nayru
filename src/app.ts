import { ZodObject } from "zod";
import { isEqual } from "lodash"; // or write your own deepCompare

export abstract class DynamicServerApp<T extends Record<string, any>> {
  abstract port: number;
  abstract schema: ZodObject<any>;

  getState(): Partial<T> {
    const state: Partial<T> = {};

    // own enumerable properties
    for (const key of Object.keys(this)) {
      if (key !== "schema" && typeof (this as any)[key] !== "function") {
        state[key as keyof T] = (this as any)[key];
      }
    }

    // include getter properties from the prototype chain
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor" || key in state) continue;
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc && typeof desc.get === "function") {
          state[key as keyof T] = (this as any)[key];
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    return state;
  }

  applyStateUpdate(data: Partial<T>): void {
    const validated = this.schema.partial().parse(data);
    Object.entries(validated).forEach(([key, value]) => {
      if (key in this) {
        (this as any)[key] = value;
      }
    });
  }

  getMetadata(): Record<string, string> {
    return Object.getOwnPropertyNames(this).reduce((meta, key) => {
      const val = (this as any)[key];
      if (typeof val !== "function") meta[key] = typeof val;
      return meta;
    }, {} as Record<string, string>);
  }

  async probe(timeout = 1000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(`http://localhost:${this.port}/state`, {
        signal: controller.signal,
      });
      clearTimeout(id);
      return res.ok;
    } catch {
      return false;
    }
  }

  async set(diff: Partial<T>): Promise<void> {
    try {
      const res = await fetch(`http://localhost:${this.port}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diff),
      });

      const response = await res.json();
      console.log("✅ Server response:", response);
    } catch (e) {
      console.error("❌ Failed to set state:", e);
    }
  }
}

export async function runDynamicApp<T extends Record<string, any>>(appInstance: DynamicServerApp<T>): Promise<void> {
  const rawDefaults = appInstance.getState() as T;

  const { state, rawFlags, mode, targetKeys } = cliToState(rawDefaults);
  const stateDiff = diffStatePatch(state, appInstance.getState() as T);

  const routes = buildRoutes(appInstance);

  if (mode === "get" && targetKeys.length > 0) {
    const isRunning = await appInstance.probe(); // ✅ define this first
    let current: Partial<T> = {};

    if (isRunning) {
      const res = await fetch(`http://localhost:${appInstance.port}/state`);
      current = await res.json() as Partial<T>;
    } else {
      current = appInstance.getState();
    }

    for (const key of targetKeys) {
      const currentState = current as Record<string, any>;
      console.log(`${key}:`, currentState[key]);
    }
    return;
  }

  if (mode === "set" && Object.keys(stateDiff).length > 0) {
    const isRunning = await appInstance.probe();
    if (isRunning) {
      await appInstance.set(stateDiff);
      const res = await fetch(`http://localhost:${appInstance.port}/state`);
      const json = await res.json();
    } else {
      appInstance.applyStateUpdate(stateDiff);
    }
    return;
  }

  if (rawFlags.length) {
    const handler = routes[`/${rawFlags[0]}`];
    const isRunning = await appInstance.probe();

    if (handler) {
      if (isRunning) {
        console.log(`🛰️ Proxying --${rawFlags[0]} to running server at port ${appInstance.port}...`);
        const argsToSend = JSON.stringify(process.argv.slice(3)); // add this
        const res = await fetch(`http://localhost:${appInstance.port}/${rawFlags[0]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: argsToSend,
        });
        const json = await res.json();
        console.log("✅ Remote result:", json);
        return;
      } else {
        console.log(`🚀 Invoking local method --${rawFlags[0]}`);
        await handler(appInstance, process.argv.slice(3)); // add this
        return;
      }
    }
  }

  if (!(await appInstance.probe())) {
    console.log(`Starting server...`);
    return startServer(appInstance, { port: appInstance.port, routes });
  } else {
    console.log(`Server is already running on port ${appInstance.port}.`);
  }

  if (Object.keys(stateDiff).length > 0) {
    await appInstance.set(stateDiff);
  }
}

function buildRoutes<T extends Record<string, any>>(
  appInstance: DynamicServerApp<T>
): Record<string, RemoteAction<T>> {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(appInstance))
    .filter(key => key !== "constructor" && typeof (appInstance as any)[key] === "function")
    .reduce((acc, key) => {
      acc[`/${key}`] = async (app, args) => {
        const actualArgs = Array.isArray(args) ? args : [];
        return await (app as any)[key](...actualArgs);
      };
      return acc;
    }, {} as Record<string, RemoteAction<T>>);
}

export type RemoteAction<T extends Record<string, any>> = (
  appInstance: DynamicServerApp<T>,
  args?: any
) => Promise<any>;

import http from "http";

export function startServer<T extends Record<string, any>>(
  appInstance: DynamicServerApp<T>,
  options: {
    port?: number;
    routes?: Record<string, RemoteAction<T>>;
  } = {}
) {
  const port = options.port ?? 2001;
  const routes = options.routes ?? {};

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";

    if (url.pathname === "/state") {
      if (method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(appInstance.getState()));
        return;
      }

      if (method === "POST") {
        let body = "";
        req.on("data", chunk => (body += chunk));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const before = appInstance.getState();

            const patch: Partial<T> = {};
            for (const key in parsed) {
              if (!isEqual(parsed[key], before[key])) {
                (patch as any)[key] = parsed[key];
              }
            }

            if (Object.keys(patch).length > 0) {
              appInstance.applyStateUpdate(patch);
              console.log("✅ State updated:", appInstance.getState());
            } else {
              console.log("⏭ No differences, skipping update");
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", state: appInstance.getState() }));
          } catch (err: any) {
            console.error("❌ Parse error:", err);
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || "Invalid JSON" }));
          }
        });

        return;
      }


      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    if (method === "POST" && routes[url.pathname]) {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body);
          if (typeof routes[url.pathname] === "function") {
            const result = await routes[url.pathname]!(appInstance, parsed);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", result }));
          } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Route not found" }));
          }
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

// src/core/CLI.ts
export function cliToState<T extends Record<string, any>>(defaults: T): { state: T; rawFlags: string[]; mode: "get" | "set" | null; targetKeys: string[] } {
  const args = process.argv.slice(2);
  const state = { ...defaults };
  const rawFlags: string[] = [];
  let mode: "get" | "set" | null = null;
  const targetKeys: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-get") {
      mode = "get";
      continue;
    }

    if (arg === "-set") {
      mode = "set";
      continue;
    }

    if (arg?.startsWith("--")) {
      const key = arg.slice(2) as keyof T;
      const next = args[i + 1];

      if (mode === "get") {
        targetKeys.push(String(key));
      } else if (mode === "set") {
        const current = defaults[key];
        const type = typeof current;

        if (type === "number" && next && !isNaN(Number(next))) {
          state[key] = Number(next) as T[typeof key];
          i++;
        } else if (type === "boolean") {
          state[key] = (next === undefined || next === "true") as T[typeof key];
        } else if (next && !next.startsWith("--")) {
          state[key] = next as T[typeof key];
          i++;
        }
      } else {
        rawFlags.push(key as string);
      }
    }
  }

  return { state, rawFlags, mode, targetKeys };
}


export function diffStatePatch<T extends Record<string, any>>(cliArgs: T, currentState: Partial<T>): Partial<T> {
  const patch: Partial<T> = {};
  for (const key in cliArgs) {
    if (cliArgs[key] !== undefined && cliArgs[key] !== currentState[key]) {
      patch[key] = cliArgs[key];
    }
  }
  return patch;
}
