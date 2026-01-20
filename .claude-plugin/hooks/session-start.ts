#!/usr/bin/env bun
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const WORKER_PORT = parseInt(process.env.MEM_ORACLE_PORT || "7432");
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const DATA_DIR = process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle");
const PID_FILE = join(DATA_DIR, "worker.pid");
const LOG_FILE = join(DATA_DIR, "worker.log");

function getPluginRoot(): string {
  return dirname(dirname(dirname(new URL(import.meta.url).pathname)));
}

async function isWorkerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureDataDir(): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir(DATA_DIR, { recursive: true });
}

async function startWorker(): Promise<boolean> {
  const pluginRoot = getPluginRoot();
  const entryPoint = join(pluginRoot, "src", "index.ts");

  if (!existsSync(entryPoint)) {
    console.error(`[mem-oracle] Entry point not found: ${entryPoint}`);
    return false;
  }

  await ensureDataDir();

  const { openSync, writeFileSync } = await import("fs");
  const logFd = openSync(LOG_FILE, "a");

  const child = spawn("bun", ["run", entryPoint, "worker"], {
    cwd: pluginRoot,
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
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (await isWorkerRunning()) {
      return true;
    }
  }

  return false;
}

async function main() {
  if (await isWorkerRunning()) {
    console.error("[mem-oracle] Worker service running");
    return;
  }

  console.error("[mem-oracle] Starting worker service...");

  if (await startWorker()) {
    console.error("[mem-oracle] Worker service started successfully");
  } else {
    console.error("[mem-oracle] Failed to start worker. Check logs at: " + LOG_FILE);
  }
}

main().catch(console.error);
