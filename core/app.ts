
import { isEqual } from "lodash";
import { exec } from "child_process";
import net from "net";
import http from "http";

// Utility type to extract state from class properties
export type ExtractState<T> = {
  [K in keyof T as T[K] extends Function ? never : K]: T[K];
};

export abstract class DynamicServerApp<T extends Record<string, any>> {
  port = 2000;

  isServerInstance = false;
  private isDevelopment = false;
  private logPrefix = '';

  private getStateFilePath(): string {
    // Use port-specific filename only for server instances or when port is explicitly set
    const isServerInstance = (this as any).isServerInstance;
    const portExplicitlySet = (this as any).portExplicitlySet;

    if (isServerInstance || portExplicitlySet) {
      return `core/.app-state-${this.port}.json`;
    } else {
      return `core/.app-state.json`;
    }
  }

  // Port-specific logging
  private createLogPrefix(port: number): string {
    return `[${port}]`;
  }

  private log(message: string, emoji = '🔹'): void {
    const prefix = this.logPrefix || '';
    console.log(`${prefix} ${emoji} ${message}`);
  }

  private logError(message: string): void {
    this.log(message, '🔸');
  }

  private logSuccess(message: string): void {
    this.log(message, '🔹');
  }

  public getState(): Partial<T> {
    const state: Partial<T> = {};
    const exclude = new Set([
      "schema",
      "logToUI",
      "notifyEnabled",
      "isServerInstance",
      "logPrefix",
      "stateFile",
      "isDevelopment",
      "audio" // Exclude audio controller from state to prevent method loss
    ]);

    // Only exclude port if it wasn't explicitly set or we're not in server mode
    const shouldExcludePort = !(this as any).portExplicitlySet && !(this as any).isServerInstance;
    if (shouldExcludePort) {
      exclude.add("port");
    }

    for (const key of Object.keys(this)) {
      if (!exclude.has(key) && typeof (this as any)[key] !== "function") {
        state[key as keyof T] = (this as any)[key];
      }
    }

    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor" || key in state || exclude.has(key)) continue;
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc?.get) state[key as keyof T] = (this as any)[key];
      }
      proto = Object.getPrototypeOf(proto);
    }
    return state;
  }

  applyStateUpdate(data: Partial<T>): void {
    // Properties to exclude from state updates (preserve original instances)
    const excludeFromUpdate = new Set(['audio']);

    // Simple validation: only update properties that exist on the instance
    Object.entries(data).forEach(([key, value]) => {
      if (!excludeFromUpdate.has(key) && Object.prototype.hasOwnProperty.call(this, key)) {
        (this as any)[key] = value;
      }
    });

    // Add timestamp to track when state was last updated
    (this as any).lastUpdated = new Date().toISOString();

    // Auto-save state always
    this.saveState().catch(console.error);
  }

  async saveState(): Promise<void> {
    try {
      const state = this.getState();
      const stateFilePath = this.getStateFilePath();
      await Bun.write(stateFilePath, JSON.stringify(state, null, 2));
      if (this.isDevelopment) {
        this.logSuccess(`State saved to ${stateFilePath}`);
      }
    } catch (error) {
      this.logError(`Failed to save state: ${error}`);
    }
  }

  async loadState(): Promise<void> {
    try {
      const stateFilePath = this.getStateFilePath();
      const data = await Bun.file(stateFilePath).text();
      const state = JSON.parse(data);
      this.applyStateUpdate(state);
      this.logSuccess(`State restored from ${stateFilePath}`);
    } catch (error) {
      // Only show message if file doesn't exist (ENOENT), not for other errors
      if ((error as any).code === 'ENOENT') {
        this.logSuccess('State created at ' + this.getStateFilePath());
      }
    }
  }

  enableAutoSave(): void {
    // Override property assignments to auto-save
    const originalThis = this;
    const stateProperties = Object.keys(this.getState());

    stateProperties.forEach(prop => {
      const descriptor = Object.getOwnPropertyDescriptor(this, prop);
      if (descriptor && !descriptor.set) {
        let value = (this as any)[prop];
        Object.defineProperty(this, prop, {
          get() { return value; },
          set(newValue) {
            value = newValue;
            originalThis.saveState().catch(console.error);
          },
          enumerable: true,
          configurable: true
        });
      }
    });
  }



  private wrapMethod(methodName: string, method: Function) {
    return async (...args: any[]) => {
      const start = Date.now();
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - start;
        if (this.isDevelopment) {
          this.logSuccess(`${methodName} completed in ${duration}ms`);
        }
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        if (this.isDevelopment) {
          this.logError(`${methodName} failed after ${duration}ms: ${(error as Error).message}`);
        }
        throw error;
      }
    };
  }

  enableMethodInterception(): void {
    if (!this.isDevelopment) return;

    const prototype = Object.getPrototypeOf(this);
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => name !== 'constructor' && typeof (this as any)[name] === 'function');

    methodNames.forEach(methodName => {
      const originalMethod = (this as any)[methodName];
      (this as any)[methodName] = this.wrapMethod(methodName, originalMethod);
    });
  }

  async probe(timeout = 1000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(`http://localhost:${this.port}/state`, { signal: controller.signal });
      clearTimeout(id);
      return res.ok;
    } catch {
      return false;
    }
  }

  async setState(diff: Partial<T>): Promise<Partial<T> | undefined> {
    const isLocal = !(await this.probe());
    if (isLocal) {
      this.applyStateUpdate(diff);
      return this.getState();
    }
    try {
      const res = await fetch(`http://localhost:${this.port}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diff),
      });
      const response = await res.json() as { state?: Partial<T> };
      return response?.state;
    } catch (e) {
      this.logError(`Failed to set state: ${e}`);
    }
    return undefined;
  }
}

export async function runDynamicApp<T extends Record<string, any>>(
  app: DynamicServerApp<T>
): Promise<void> {
  const { serve, notify, port, dev, view, setState, targetPort, command, property, value, methodName, methodArgs } = cliToState(app.getState() as T);
  const portExplicitlySet = !!port;
  if (port) app.port = port;
  (app as any).notifyEnabled = notify;
  (app as any).isDevelopment = dev;
  (app as any).portExplicitlySet = portExplicitlySet;

  // Set log prefix for this instance (only show port if explicitly set via CLI)
  if (portExplicitlySet || serve) {
    (app as any).logPrefix = `[${app.port}]`;
  } else {
    (app as any).logPrefix = '';
  }

  // Handle view flag - show functions and variables
  if (view) {
    showApplicationStructure(app);
    process.exit(0);
  }

  // Handle set-state flag - set state on target port
  if (setState && targetPort) {
    await setStateOnPort(setState, targetPort);
    process.exit(0);
  }

  // Handle set/get/call commands
  if (command) {
    const targetPortForCommand = port || targetPort || app.port;

    if (command === 'set' && property && value !== undefined) {
      // Parse value (try JSON first, then string)
      let parsedValue: any = value;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Keep as string if not valid JSON
      }

      const stateUpdate = { [property]: parsedValue } as Partial<T>;
      await setStateOnPort(stateUpdate, targetPortForCommand);
      process.exit(0);
    } else if (command === 'get' && property) {
      await getStateFromPort(property, targetPortForCommand);
      process.exit(0);
    } else if (command === 'call' && methodName) {
      await callMethodOnPort(methodName, targetPortForCommand, methodArgs);
      process.exit(0);
    }
  }

  // Initialize auto-save and state loading
  await (app as any).loadState();

  // Set initial timestamp if not already set
  if (!(app as any).lastUpdated) {
    (app as any).lastUpdated = new Date().toISOString();
  }

  // Save initial state
  await (app as any).saveState();

  (app as any).enableAutoSave();

  // Add separator line before application output
  if (!serve) {
    console.log('');
  }

  // Initialize development features
  if (dev) {
    (app as any).logSuccess('Development mode enabled');
    (app as any).enableMethodInterception();
  }

  // Check if there's already a server running on this port (only if port was explicitly set)
  let isServerRunning = false;
  if (port) {
    isServerRunning = await app.probe();
    if (isServerRunning && !serve) {
      (app as any).logSuccess(`Connected to existing server on port ${app.port}`);
    } else if (!isServerRunning && !serve) {
      (app as any).logError(`Server not found on port ${app.port}`);
    }
  }


  const handleResult = (res: any) => {
    if (res !== undefined) {
      console.log(res);
      if (notify) sendNotification("🔹 App Finished", `Port ${app.port}`);
    }
  };

  // ── serve command ──────────────────────────────────────────────────────────
  if (serve) {
    if (isServerRunning) (app as any).logError(`Server already running on port ${app.port}. Starting on next available port...`);
    await startServer(app, {
      port: app.port,
      routes: buildRoutes(app),
    });
    return;
  }

  // ── default function ──────────────────────────────────────────────────────
  if (typeof (app as any).defaultFunction === "function") {
    try {
      const res = await (app as any).defaultFunction();
      handleResult(res);
      process.exit(0);
    } catch (err: any) {
      (app as any).logError(`Error running defaultFunction: ${err.message}`);
      process.exit(1);
    }
  } else {
    // (app as any).logError("No defaultFunction found. App completed.");
    process.exit(0);
  }
}

function buildRoutes<T extends Record<string, any>>(app: DynamicServerApp<T>): Record<string, RemoteAction<T>> {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(app))
    .filter(k => k !== "constructor" && typeof (app as any)[k] === "function")
    .reduce((routes, key) => {
      routes[`/${key}`] = async (app, args) => {
        // args is already an array from the server handler
        // Ensure the method is called with the correct 'this' context
        const method = (app as any)[key];
        return await method.apply(app, args);
      };
      return routes;
    }, {} as Record<string, RemoteAction<T>>);
}

export type RemoteAction<T extends Record<string, any>> = (app: DynamicServerApp<T>, args?: any) => Promise<any>;

export async function startServer<T extends Record<string, any>>(
  app: DynamicServerApp<T>,
  options: { port?: number; routes?: Record<string, RemoteAction<T>> } = {}
) {
  let port = await findAvailablePort(options.port ?? 2000);
  app.port = port;
  const routes = options.routes ?? {};

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";

    // Log incoming requests (except for /state requests which are logged separately)
    if (url.pathname !== "/state") {
      (app as any).logSuccess(`${method} ${url.pathname} - Remote interaction`);
    }

    if (url.pathname === "/state") {
      if (method === "GET") {
        // Log state retrieval
        // (app as any).logSuccess(`State retrieval: GET /state`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(app.getState()));
      } else if (method === "POST") {
        let body = "";
        req.on("data", chunk => (body += chunk));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const patch: Partial<T> = {};
            const current = app.getState();
            for (const key in parsed) {
              if (!isEqual(parsed[key], current[key])) (patch as any)[key] = parsed[key];
            }
            if (Object.keys(patch).length) {
              // Log detailed state update
              (app as any).logSuccess(`State update: ${JSON.stringify(patch)}`);
              app.applyStateUpdate(patch);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", state: app.getState() }));
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || "Invalid JSON" }));
          }
        });
      } else {
        res.writeHead(405);
        res.end("Method Not Allowed");
      }
      return;
    }

    // Method explorer endpoint
    if (url.pathname === "/methods") {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(app))
        .filter(k => k !== "constructor" && typeof (app as any)[k] === "function")
        .map(methodName => ({
          name: methodName,
          signature: getMethodSignature(app, methodName)
        }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ methods }));
      return;
    }

    if (method === "POST" && routes[url.pathname]) {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body);
          const methodName = url.pathname.substring(1); // Remove leading slash

          // Log method call with arguments
          (app as any).logSuccess(`Method call: ${methodName}(${JSON.stringify(parsed)})`);

          // Pass the parsed data as arguments to the method
          const result = await routes[url.pathname]!(app, Array.isArray(parsed) ? parsed : [parsed]);

          // Log method result
          // (app as any).logSuccess(`Method result: ${methodName} -> ${JSON.stringify(result)}`);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", result }));
        } catch (err: any) {
          (app as any).logError(`Method error: ${url.pathname.substring(1)} -> ${err.message}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  app.isServerInstance = true;
  server.listen(port, () => {
    // Set server start timestamp
    (app as any).serverStarted = new Date().toISOString();
    (app as any).logSuccess(`Server started.`);
  });

  // Graceful shutdown handling
  const gracefulShutdown = (signal: string) => {
    server.close(() => {
      process.exit(0);
    });
    // Force close after 5 seconds
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  };
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

export function cliToState<T extends Record<string, any>>(defaults: T): {
  serve: boolean;
  notify: boolean;
  port?: number;
  dev: boolean;
  view: boolean;
  setState?: Partial<T>;
  targetPort?: number;
  command?: 'set' | 'get' | 'call';
  property?: string;
  value?: string;
  methodName?: string;
  methodArgs?: string[];
} {
  const args = process.argv.slice(2);
  let serve = false;
  let notify = false;
  let port: number | undefined;
  let dev = false;
  let view = false;
  let setState: Partial<T> | undefined;
  let targetPort: number | undefined;
  let command: 'set' | 'get' | 'call' | undefined;
  let property: string | undefined;
  let value: string | undefined;
  let methodName: string | undefined;
  let methodArgs: string[] = [];

  // Parse command (set/get/call) and property
  if (args.length > 0 && (args[0] === 'set' || args[0] === 'get' || args[0] === 'call')) {
    command = args[0] as 'set' | 'get' | 'call';
    if (args.length > 1) {
      if (command === 'call') {
        methodName = args[1];
        // All remaining args are method arguments
        methodArgs = args.slice(2);
      } else {
        property = args[1];
        if (command === 'set' && args.length > 2) {
          value = args[2];
        }
      }
    }
  }

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--serve") serve = true;
    if (arg === "--notify") notify = true;
    if (arg === "--port") {
      port = Number(args[i + 1]);
      i++; // Skip the port argument
    }
    if (arg === "--dev") dev = true;
    if (arg === "--view") view = true;
    if (arg === "--set-state") {
      try {
        const stateJson = args[i + 1];
        if (stateJson) {
          setState = JSON.parse(stateJson);
          i++; // Skip the JSON argument
        }
      } catch (e) {
        console.error("🔸 Invalid JSON in --set-state:", e);
        process.exit(1);
      }
    }
    if (arg === "--target-port") {
      targetPort = Number(args[i + 1]);
      i++; // Skip the port argument
    }
  }

  return { serve, notify, port, dev, view, setState, targetPort, command, property, value, methodName, methodArgs };
}


export function diffStatePatch<T extends Record<string, any>>(cliArgs: T, current: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(cliArgs).filter(([k, v]) => v !== undefined && v !== current[k])) as Partial<T>;
}

export function sendNotification(title: string, body: string) {
  exec(`notify-send "${title}" "${body.replace(/"/g, '\\"')}"`);
}

function getMethodSignature(app: any, methodName: string): string {
  const method = app[methodName];
  if (typeof method !== 'function') return 'unknown';

  // Try to get the original method from the prototype
  const prototype = Object.getPrototypeOf(app);
  const originalMethod = prototype[methodName];

  if (originalMethod && typeof originalMethod === 'function') {
    const source = originalMethod.toString();
    const match = source.match(/\(([^)]*)\)/);
    if (match) {
      const params = match[1].trim();
      return params ? `${methodName}(${params})` : `${methodName}()`;
    }
  }

  return `${methodName}()`;
}





async function findAvailablePort(start: number, maxAttempts = 50): Promise<number> {
  for (let port = start, i = 0; i < maxAttempts; i++, port++) {
    const isFree = await new Promise<boolean>(resolve => {
      const server = net.createServer()
        .once("error", () => resolve(false))
        .once("listening", () => server.close(() => resolve(true)))
        .listen(port);
    });
    if (isFree) return port;
  }
  throw new Error(`No available ports found starting from ${start}`);
}

async function getStateFromPort(property: string, targetPort: number): Promise<void> {
  try {
    console.log(`🔹 Getting ${property} from port ${targetPort}...`);

    // Check if server is running on target port
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000);

    let res: Response;
    try {
      res = await fetch(`http://localhost:${targetPort}/state`, { signal: controller.signal });
    } catch (fetchError: any) {
      clearTimeout(id);
      if (fetchError.name === 'AbortError') {
        console.error(`🔸 Connection timeout to port ${targetPort}`);
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`🔸 Server not found on port ${targetPort}`);
      } else {
        console.error(`🔸 Network error connecting to port ${targetPort}: ${fetchError.message}`);
      }
      process.exit(1);
    }

    clearTimeout(id);

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      console.error(`🔸 Server error on port ${targetPort}: ${res.status} ${res.statusText} - ${errorText}`);
      process.exit(1);
    }

    let state: Record<string, any>;
    try {
      state = await res.json() as Record<string, any>;
    } catch (parseError) {
      console.error(`🔸 Invalid JSON response from port ${targetPort}:`, parseError);
      process.exit(1);
    }

    const value = state[property];

    if (value !== undefined) {
      console.log(`🔹 ${property}: ${JSON.stringify(value)}`);
    } else {
      console.log(`🔸 Property '${property}' not found in state`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`🔸 Unexpected error getting ${property} from port ${targetPort}:`, error);
    process.exit(1);
  }
}

async function setStateOnPort<T extends Record<string, any>>(stateUpdate: Partial<T>, targetPort: number): Promise<void> {
  try {
    console.log(`🔹 Setting state on port ${targetPort}...`);

    // Check if server is running on target port
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000);

    let probeRes: Response;
    try {
      probeRes = await fetch(`http://localhost:${targetPort}/state`, { signal: controller.signal });
    } catch (fetchError: any) {
      clearTimeout(id);
      if (fetchError.name === 'AbortError') {
        console.error(`🔸 Connection timeout to port ${targetPort}`);
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`🔸 Server not found on port ${targetPort}`);
      } else {
        console.error(`🔸 Network error connecting to port ${targetPort}: ${fetchError.message}`);
      }
      process.exit(1);
    }

    clearTimeout(id);

    if (!probeRes.ok) {
      const errorText = await probeRes.text().catch(() => 'Unknown error');
      console.error(`🔸 Server error on port ${targetPort}: ${probeRes.status} ${probeRes.statusText} - ${errorText}`);
      process.exit(1);
    }

    // Set the state
    let res: Response;
    try {
      res = await fetch(`http://localhost:${targetPort}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stateUpdate),
      });
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        console.error(`🔸 Connection timeout setting state on port ${targetPort}`);
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`🔸 Server disconnected while setting state on port ${targetPort}`);
      } else {
        console.error(`🔸 Network error setting state on port ${targetPort}: ${fetchError.message}`);
      }
      process.exit(1);
    }

    if (res.ok) {
      let response: { state?: Partial<T> };
      try {
        response = await res.json() as { state?: Partial<T> };
      } catch (parseError) {
        console.error(`🔸 Invalid JSON response from port ${targetPort}:`, parseError);
        process.exit(1);
      }
      console.log(`🔹 State updated successfully on port ${targetPort}:`);
      console.log(JSON.stringify(response.state, null, 2));
    } else {
      const errorText = await res.text().catch(() => 'Unknown error');
      console.error(`🔸 Failed to set state on port ${targetPort}: ${res.status} ${res.statusText} - ${errorText}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`🔸 Unexpected error setting state on port ${targetPort}:`, error);
    process.exit(1);
  }
}

export function showApplicationStructure<T extends Record<string, any>>(app: DynamicServerApp<T>): void {
  console.log('🔹 Application Structure:');
  console.log('\n🔧 Functions:');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(app))
    .filter(k => k !== "constructor" && typeof (app as any)[k] === "function");
  methods.forEach(methodName => {
    const signature = getMethodSignature(app, methodName);
    console.log(`  • ${signature}`);
  });

  console.log('\n🔹 Variables:');
  const state = app.getState();
  Object.entries(state).forEach(([key, value]) => {
    const type = typeof value;
    const preview = type === 'object' ? JSON.stringify(value).substring(0, 50) + '...' : String(value);
    console.log(`  • ${key}: ${type} = ${preview}`);
  });
}

async function callMethodOnPort(methodName: string, targetPort: number, args: any[] = []): Promise<void> {
  try {
    console.log(`🔹 Calling ${methodName} on port ${targetPort}...`);

    // Check if server is running on target port
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000);

    let probeRes: Response;
    try {
      probeRes = await fetch(`http://localhost:${targetPort}/state`, { signal: controller.signal });
    } catch (fetchError: any) {
      clearTimeout(id);
      if (fetchError.name === 'AbortError') {
        console.error(`🔸 Connection timeout to port ${targetPort}`);
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`🔸 Server not found on port ${targetPort}`);
      } else {
        console.error(`🔸 Network error connecting to port ${targetPort}: ${fetchError.message}`);
      }
      process.exit(1);
    }

    clearTimeout(id);

    if (!probeRes.ok) {
      const errorText = await probeRes.text().catch(() => 'Unknown error');
      console.error(`🔸 Server error on port ${targetPort}: ${probeRes.status} ${probeRes.statusText} - ${errorText}`);
      process.exit(1);
    }

    // Call the method
    let res: Response;
    try {
      res = await fetch(`http://localhost:${targetPort}/${methodName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args), // Pass the actual arguments
      });
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        console.error(`🔸 Connection timeout calling ${methodName} on port ${targetPort}`);
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`🔸 Server disconnected while calling ${methodName} on port ${targetPort}`);
      } else {
        console.error(`🔸 Network error calling ${methodName} on port ${targetPort}: ${fetchError.message}`);
      }
      process.exit(1);
    }

    if (res.ok) {
      let response: { status?: string; result?: any };
      try {
        response = await res.json() as { status?: string; result?: any };
      } catch (parseError) {
        console.error(`🔸 Invalid JSON response from port ${targetPort}:`, parseError);
        process.exit(1);
      }

      if (response.result !== undefined) {
        console.log(`🔹 ${methodName} result:`, response.result);
      } else {
        console.log(`🔹 ${methodName} completed successfully`);
      }
    } else {
      const errorText = await res.text().catch(() => 'Unknown error');
      console.error(`🔸 Failed to call ${methodName} on port ${targetPort}: ${res.status} ${res.statusText} - ${errorText}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`🔸 Unexpected error calling ${methodName} on port ${targetPort}:`, error);
    process.exit(1);
  }
}
