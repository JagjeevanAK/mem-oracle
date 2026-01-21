#!/usr/bin/env bun
/**
 * mem-oracle worker service management script
 * Called by Claude Code hooks to start/ensure worker is running
 */

import { spawn } from "child_process";
import { existsSync, openSync, writeFileSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

const WORKER_PORT = parseInt(process.env.MEM_ORACLE_PORT || "7432");
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const DATA_DIR = process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle");
const PID_FILE = join(DATA_DIR, "worker.pid");
const LOG_FILE = join(DATA_DIR, "worker.log");

function getRepoRoot() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    return dirname(dirname(pluginRoot));
  }
  return dirname(dirname(dirname(new URL(import.meta.url).pathname)));
}

async function isWorkerRunning() {
  try {
    const response = await fetch(`${WORKER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(join(DATA_DIR, "cache"), { recursive: true });
  await mkdir(join(DATA_DIR, "vectors"), { recursive: true });
}

async function startWorker() {
  const repoRoot = getRepoRoot();
  const entryPoint = join(repoRoot, "src", "index.ts");

  if (!existsSync(entryPoint)) {
    console.error(`[mem-oracle] Entry point not found: ${entryPoint}`);
    return false;
  }

  await ensureDataDir();

  const logFd = openSync(LOG_FILE, "a");

  const child = spawn("bun", ["run", entryPoint, "worker"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      MEM_ORACLE_PORT: String(WORKER_PORT),
      MEM_ORACLE_DATA_DIR: DATA_DIR,
    },
  });

  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (await isWorkerRunning()) {
      return true;
    }
  }

  return false;
}

async function installDependencies() {
  const repoRoot = getRepoRoot();
  const nodeModules = join(repoRoot, "node_modules");

  if (existsSync(nodeModules)) {
    return true;
  }

  console.error("[mem-oracle] Installing dependencies...");

  try {
    const { execSync } = await import("child_process");
    execSync("bun install", { cwd: repoRoot, stdio: "inherit" });
    console.error("[mem-oracle] Dependencies installed");
    return true;
  } catch (error) {
    console.error("[mem-oracle] Failed to install dependencies:", error);
    return false;
  }
}

async function main() {
  const command = process.argv[2] || "start";

  switch (command) {
    case "start":
      await installDependencies();
      
      if (await isWorkerRunning()) {
        console.error("[mem-oracle] Worker already running");
        return;
      }

      console.error("[mem-oracle] Starting worker service...");
      if (await startWorker()) {
        console.error("[mem-oracle] Worker started successfully on port " + WORKER_PORT);
      } else {
        console.error("[mem-oracle] Failed to start worker. Check logs: " + LOG_FILE);
      }
      break;

    case "ensure":
      if (!(await isWorkerRunning())) {
        console.error("[mem-oracle] Worker not running, starting...");
        await startWorker();
      }
      break;

    case "status":
      const running = await isWorkerRunning();
      console.log(JSON.stringify({ running, port: WORKER_PORT }));
      break;

    case "stop":
      if (existsSync(PID_FILE)) {
        const pid = readFileSync(PID_FILE, "utf-8").trim();
        try {
          process.kill(parseInt(pid), "SIGTERM");
          console.error("[mem-oracle] Worker stopped");
        } catch {
          console.error("[mem-oracle] Worker not running");
        }
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(console.error);
