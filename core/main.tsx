#!/usr/bin/env bun
import { runDynamicApp } from "./app";
import { Nayru } from "../src/Nayru";

const instance = new Nayru();

await runDynamicApp(instance);
