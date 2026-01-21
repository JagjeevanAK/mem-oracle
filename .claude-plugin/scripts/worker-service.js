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

async function getIndexingStatus() {
  try {
    const response = await fetch(`${WORKER_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Status check failed
  }
  return null;
}

async function getActiveIndexingInfo() {
  const status = await getIndexingStatus();
  if (!status || !status.docsets) {
    return { active: false, pending: 0, total: 0 };
  }
  
  let totalPending = 0;
  let totalPages = 0;
  let hasActive = false;
  
  for (const docset of status.docsets) {
    if (docset.status === "indexing" && docset.indexStatus) {
      const { pendingPages = 0, totalPages: docTotal = 0 } = docset.indexStatus;
      if (pendingPages > 0) {
        hasActive = true;
        totalPending += pendingPages;
        totalPages += docTotal;
      }
    }
  }
  
  return { active: hasActive, pending: totalPending, total: totalPages };
}

async function hasActivejobs() {
  const info = await getActiveIndexingInfo();
  return info.active;
}

async function waitForIndexingComplete(maxWaitMs = 30 * 60 * 1000) {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds
  
  while (Date.now() - startTime < maxWaitMs) {
    const info = await getActiveIndexingInfo();
    
    if (!info.active) {
      return true;
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`[mem-oracle] Waiting for indexing... ${info.pending} pages pending (${elapsed}s elapsed)`);
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  console.error("[mem-oracle] Max wait time exceeded, indexing still in progress");
  return false;
}

async function stopWorker() {
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, "utf-8").trim();
    try {
      process.kill(parseInt(pid), "SIGTERM");
      writeFileSync(PID_FILE, "");
      return true;
    } catch {
      return false;
    }
  }
  return false;
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
      if (await stopWorker()) {
        console.error("[mem-oracle] Worker stopped");
      } else {
        console.error("[mem-oracle] Worker not running");
      }
      break;

    case "stop-if-idle":
      // Quick check - if no active jobs, stop immediately
      if (!(await isWorkerRunning())) {
        console.error("[mem-oracle] Worker not running");
        return;
      }

      if (!(await hasActivejobs())) {
        console.error("[mem-oracle] No active indexing, stopping worker...");
        if (await stopWorker()) {
          console.error("[mem-oracle] Worker stopped");
        }
        return;
      }

      // Indexing active - spawn background cleanup and exit immediately
      console.error("[mem-oracle] Indexing in progress, spawning background cleanup...");
      const cleanupScript = process.argv[1];
      const child = spawn("bun", [cleanupScript, "stop-after-indexing"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      console.error("[mem-oracle] Background cleanup started, Claude Code can exit");
      break;

    case "stop-after-indexing":
      // Background process - wait for indexing then stop
      if (!(await isWorkerRunning())) {
        return;
      }

      console.error("[mem-oracle] Background: waiting for indexing to complete...");
      const completed = await waitForIndexingComplete();
      
      if (completed) {
        console.error("[mem-oracle] Background: indexing complete, stopping worker...");
        await stopWorker();
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(console.error);
