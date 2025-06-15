#!/usr/bin/env bun
import { render } from "ink";
import { cliToState, runDynamicApp } from "./app";
import { AppCli } from "./cli";
import { Nayru } from "../src/Nayru";

const instance = new Nayru();
const { returnOutput } = cliToState(instance.getState());

await runDynamicApp(instance);

// Only render the UI if --return is NOT present
if (!returnOutput) {
  render(<AppCli app={instance} />);
}
