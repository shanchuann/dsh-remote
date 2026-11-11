#!/usr/bin/env node
/**
 * Run every test file under test/ in one node:test process. Helpers are
 * excluded because only *.test.mjs files are listed explicitly.
 */
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const entries = await readdir(testDir);
const files = entries.filter((name) => name.endsWith(".test.mjs")).sort().map((name) => join(testDir, name));
if (files.length === 0) {
  process.stderr.write("dsh-remote: no *.test.mjs files under " + testDir + "\n");
  process.exitCode = 1;
} else {
  // Serial file execution: each file binds a real port and writes temp homes,
  // and Windows is noticeably flakier when a dozen listeners start at once.
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.stderr.write("dsh-remote: test runner terminated by " + signal + "\n");
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}
