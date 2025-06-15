import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { DynamicServerApp } from "./app";

export interface AppProps {
  app: DynamicServerApp<any>;
}

export function AppCli({ app }: AppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<Record<string, any>>({});
  const [inputValue, setInputValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [isSynced, setIsSynced] = useState<boolean>(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  async function refresh() {
    const isRunning = await app.probe();
    const data = isRunning
      ? await fetch(`http://localhost:${app.port}/state`).then((r) => r.json())
      : app.getState();
    setState({ ...(typeof data === "object" && data !== null ? data : {}) });
  }

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const initialize = async () => {
      const schemaKeys = Object.keys(app.schema.shape);
      setState((prev) => {
        const placeholder: Record<string, any> = {};
        for (const key of schemaKeys) {
          placeholder[key] = prev[key] ?? "";
        }
        return placeholder;
      });

      const isRunning = await app.probe();
      setIsSynced(isRunning);

      await refresh();
      interval = setInterval(refresh, 1000);
    };
    void initialize();
    return () => clearInterval(interval);
  }, []);

  const functionNames = Object.getOwnPropertyNames(Object.getPrototypeOf(app))
    .filter((k) => typeof (app as any)[k] === "function" && k !== "constructor");

  async function handleCommand(command: string) {
    const [cmd, ...args] = command.trim().split(" ");

    if (cmd === "exit") return exit();

    if (cmd === "get") {
      const key = args[0];
      if (!key) return app.setSystemMessage("Please specify a key.");
      if (key === "port") return app.setSystemMessage(`Access to 'port' is restricted.`);
      app.setSystemMessage(`${state[key as keyof typeof state] ?? ""}`);
    }

    else if (cmd === "set") {
      const key = String(args[0]);
      if (key === "port") return app.setSystemMessage(`'port' cannot be modified.`);
      const value = args.slice(1).join(" ");
      const updatedState = await app.setState({ [key]: value });
      if (updatedState) {
        setState({ ...updatedState });
      } else {
        await refresh();
      }
      app.setSystemMessage(`set ${key}: ${value}`);
    }

    else if (
      cmd === "call" ||
      (typeof cmd === "string" && (functionNames.includes(cmd) || cmd.endsWith("()")))
    ) {
      const fn = cmd === "call" ? args[0] : cmd.replace(/\(\)$/, "");
      if (!fn || typeof (app as any)[fn] !== "function") {
        return app.setSystemMessage(`Unknown function: ${fn}`);
      }

      // Combine all remaining args into one string (single parameter)
      const fnArgs = cmd === "call"
        ? [args.slice(1).join(" ")]
        : [args.join(" ")];

      try {
        const isRunning = await app.probe();
        const result = isRunning
          ? await fetch(`http://localhost:${app.port}/${fn}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fnArgs),
          }).then((r) => r.json())
          : await (app as any)[fn](...fnArgs);

        const output = isRunning ? result.result : result;
        await refresh();
        app.setSystemMessage(
          typeof output === "string"
            ? output
            : JSON.stringify(output, null, 2)
        );
      } catch (e: any) {
        app.setSystemMessage(`Error: ${e.message}`);
      }
    }

    else {
      app.setSystemMessage(`Unknown command: ${command}`);
    }

    setHistory((prev) => [...prev, command]);
    setHistoryIndex(null);
    setInputValue("");
  }

  const className = app.constructor.name;

  function renderTypedInput() {
    const [first, ...rest] = inputValue.trim().split(" ");
    const key = rest[0];
    const valueText = rest.slice(1).join(" ");
    const isFn = inputValue.trim().endsWith("()");
    const isGetSet = first === "get" || first === "set";
    const isCall = first === "call";
    const isKnownVariable = key && Object.prototype.hasOwnProperty.call(state, key);

    if (isGetSet || isCall) {
      return (
        <Text>
          <Text color={isCall ? "yellow" : "magenta"}>{first}</Text>
          {key && (
            <>
              <Text> </Text>
              <Text color={isKnownVariable ? "gray" : "cyan"}>{key}</Text>
              {valueText && (
                <>
                  <Text> </Text>
                  <Text color="white">{valueText}</Text>
                </>
              )}
            </>
          )}
        </Text>
      );
    }

    if (isFn) return <Text color="blue">{inputValue}</Text>;

    return <Text color="cyan">{inputValue}</Text>;
  }

  useInput((input, key) => {
    if (key.upArrow && history.length > 0) {
      setHistoryIndex((prev) => {
        const newIndex = prev === null ? history.length - 1 : Math.max(prev - 1, 0);
        setInputValue(history[newIndex] || "");
        return newIndex;
      });
    }
    if (key.downArrow && history.length > 0) {
      setHistoryIndex((prev) => {
        if (prev === null) return null;
        const newIndex = prev + 1;
        if (newIndex >= history.length) {
          setInputValue("");
          return null;
        }
        setInputValue(history[newIndex] || "");
        return newIndex;
      });
    }

    // Clear historyIndex when the user types normally
    if (!key.upArrow && !key.downArrow && input && input.length === 1) {
      setHistoryIndex(null);
    }
  });


  function formatValue(val: any, depth = 1): string {
    const indent = "  ".repeat(depth);
    const outerIndent = "  ".repeat(Math.max(depth - 1, 0));

    if (val === null) return "null";
    if (typeof val === "undefined") return "undefined";
    if (typeof val !== "object") return String(val);
    if (Array.isArray(val)) {
      if (val.length === 0) return "[]";
      return `[\n${val.map((v) => indent + formatValue(v, depth + 1)).join(",\n")}\n${outerIndent}]`;
    }

    const entries = Object.entries(val);
    if (entries.length === 0) return "{}";

    return `{\n${entries
      .map(([k, v]) => `${indent}${k}: ${formatValue(v, depth + 1)}`)
      .join("\n")}\n${outerIndent}}`;
  }



  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box flexDirection="column-reverse">
        {app.systemLog.slice(-10).reverse().map((msg, idx) => (
          <Text key={idx} color="gray">{msg}</Text>
        ))}
      </Box>

      <Text>
        <Text color="cyan" bold>{className}</Text>
        <Text color="gray">
          (port {app.port})
          {isSynced && !app.isServerInstance && (
            <Text color="red">remote</Text>
          )}
        </Text>
      </Text>

      {Object.keys(state).some((key) => key !== "port" && key !== "isServerInstance") && (
        <>
          <Text bold>Variables:</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {Object.entries(state)
              .filter(([key]) => key !== "port" && key !== "isServerInstance")
              .map(([key, val]) => (
                <Box key={key} flexDirection="column">
                  <Text>
                    <Text color="gray">{key.padEnd(18)}</Text>
                  </Text>
                  <Box paddingLeft={2}>
                    <Text color="white">{formatValue(val)}</Text>
                  </Box>
                </Box>
              ))}
          </Box>

        </>
      )}

      {functionNames.length > 0 && (
        <>
          <Text bold>Functions:</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {functionNames.map((fn) => (
              <Text key={fn}>
                <Text color="blue">{fn}()</Text>
              </Text>
            ))}
          </Box>
        </>
      )}

      <Box paddingTop={1}>
        <Text color="white"> {app.systemMessage}</Text>
      </Box>

      <Box>
        <Text color="cyan">▸ </Text>
        {renderTypedInput()}
        {cursorVisible && <Text color="cyan">│</Text>}
      </Box>

      <Box height={0}>
        <TextInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleCommand}
        />
      </Box>
    </Box>
  );
}