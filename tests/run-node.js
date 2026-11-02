// Run all unit and parity tests in Node:  node tests/run-node.js
import { run } from "./harness.js";
import "./all.js";

const { failed } = await run();
process.exitCode = failed ? 1 : 0;
