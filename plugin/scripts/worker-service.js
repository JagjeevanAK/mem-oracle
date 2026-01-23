#!/usr/bin/env bun
/**
 * mem-oracle worker service management script
 * Called by Claude Code hooks to start/ensure worker is running
 * Supports session tracking - worker only stops when ALL clients disconnect
 */

import { spawn } from "child_process";
import { existsSync, openSync, writeFileSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomBytes, createHash } from "crypto";

const WORKER_PORT = parseInt(process.env.MEM_ORACLE_PORT || "7432");
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const DATA_DIR = process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle");
const PID_FILE = join(DATA_DIR, "worker.pid");
const LOG_FILE = join(DATA_DIR, "worker.log");

function readSessionFile(sessionFile) {
  try {
    if (existsSync(sessionFile)) {
      return readFileSync(sessionFile, "utf-8").trim();
    }
  } catch {}
  return null;
}

function writeSessionFile(sessionFile, sessionId) {
  try {
    writeFileSync(sessionFile, sessionId);
  } catch {}
}

function getSessionScopeKey() {
  return process.env.CLAUDE_PROJECT_ROOT
    || process.env.CLAUDE_PLUGIN_ROOT
    || "global";
}

function getSessionIdFile(clientType) {
  const scopeKey = getSessionScopeKey();
  const hash = createHash("sha256")
    .update(`${clientType}:${scopeKey}`)
    .digest("hex")
    .slice(0, 12);
  
  return join(DATA_DIR, `session-${clientType}-${hash}.id`);
}

function getLastSessionFile(clientType) {
  return join(DATA_DIR, `session-${clientType}-last.id`);
}

// Get or create a stable session ID for this client instance
function getSessionId(clientType) {
  const sessionFile = getSessionIdFile(clientType);
  const lastSessionFile = getLastSessionFile(clientType);
  
  // Prefer explicit session key if available and persist it
  if (process.env.CLAUDE_SESSION_KEY) {
    const sessionId = `claude-${process.env.CLAUDE_SESSION_KEY}`;
    writeSessionFile(sessionFile, sessionId);
    writeSessionFile(lastSessionFile, sessionId);
    return sessionId;
  }
  if (process.env.OPENCODE_SESSION) {
    const sessionId = `opencode-${process.env.OPENCODE_SESSION}`;
    writeSessionFile(sessionFile, sessionId);
    writeSessionFile(lastSessionFile, sessionId);
    return sessionId;
  }
  
  const existingSessionId = readSessionFile(sessionFile);
  if (existingSessionId) {
    writeSessionFile(lastSessionFile, existingSessionId);
    return existingSessionId;
  }

  const lastSessionId = readSessionFile(lastSessionFile);
  if (lastSessionId) {
    writeSessionFile(sessionFile, lastSessionId);
    return lastSessionId;
  }
  
  // Generate new session ID
  const sessionId = `client-${randomBytes(8).toString("hex")}`;
  writeSessionFile(sessionFile, sessionId);
  writeSessionFile(lastSessionFile, sessionId);
  
  return sessionId;
}

// Detect client type
function getClientType() {
  if (process.env.OPENCODE_SESSION) {
    return "opencode";
  }
  if (process.env.CLAUDE_SESSION_KEY || process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_PROJECT_ROOT) {
    return "claude-code";
  }
  return "unknown";
}

const REPO_URL = "https://github.com/JagjeevanAK/mem-oracle.git";
const DEFAULT_REPO_DIR = join(DATA_DIR, "repo");

function getRepoRoot() {
  // 1. Check environment variable first
  if (process.env.MEM_ORACLE_REPO_ROOT) {
    return process.env.MEM_ORACLE_REPO_ROOT;
  }
  
  // 2. Check stored repo root in data dir
  const repoRootFile = join(DATA_DIR, "repo-root.txt");
  if (existsSync(repoRootFile)) {
    const storedRoot = readFileSync(repoRootFile, "utf-8").trim();
    if (existsSync(join(storedRoot, "src", "index.ts"))) {
      return storedRoot;
    }
  }
  
  // 3. Check if repo exists in default location (~/.mem-oracle/repo)
  if (existsSync(join(DEFAULT_REPO_DIR, "src", "index.ts"))) {
    return DEFAULT_REPO_DIR;
  }
  
  // 4. Check common development locations
  const commonLocations = [
    join(homedir(), "Developer", "mem-Oracle"),
    join(homedir(), "Projects", "mem-Oracle"),
    join(homedir(), "dev", "mem-oracle"),
    join(homedir(), "code", "mem-oracle"),
  ];
  
  for (const loc of commonLocations) {
    if (existsSync(join(loc, "src", "index.ts"))) {
      // Store for future use
      try {
        writeFileSync(repoRootFile, loc);
      } catch {}
      return loc;
    }
  }
  
  // 5. If script is running from actual repo (not plugin cache), use that
  const scriptPath = new URL(import.meta.url).pathname;
  if (!scriptPath.includes(".claude/plugins/cache")) {
    const repoRoot = dirname(dirname(dirname(scriptPath)));
    if (existsSync(join(repoRoot, "src", "index.ts"))) {
      return repoRoot;
    }
  }
  
  // 6. Fallback - return null (will trigger auto-clone)
  return null;
}

async function cloneRepository() {
  console.error("[mem-oracle] Repository not found, cloning from GitHub...");
  
  try {
    const { execSync } = await import("child_process");
    
    // Ensure data dir exists
    await mkdir(DATA_DIR, { recursive: true });
    
    // Clone the repository
    execSync(`git clone ${REPO_URL} "${DEFAULT_REPO_DIR}"`, {
      stdio: "inherit",
    });
    
    console.error("[mem-oracle] Repository cloned successfully");
    return DEFAULT_REPO_DIR;
  } catch (error) {
    console.error("[mem-oracle] Failed to clone repository:", error.message);
    console.error("[mem-oracle] Please manually clone:");
    console.error(`  git clone ${REPO_URL} ~/.mem-oracle/repo`);
    return null;
  }
}

async function updateRepository() {
  const repoRoot = getRepoRoot();
  if (!repoRoot || repoRoot !== DEFAULT_REPO_DIR) {
    return; // Only auto-update the default repo location
  }
  
  try {
    const { execSync } = await import("child_process");
    execSync("git pull --ff-only", { cwd: repoRoot, stdio: "pipe" });
  } catch {
    // Ignore update errors - not critical
  }
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

async function registerSessionWithWorker(sessionId, clientType) {
  try {
    const response = await fetch(`${WORKER_URL}/session/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, clientType }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      console.error(`[mem-oracle] Session registered: ${sessionId} (total: ${data.totalSessions})`);
      return data;
    }
  } catch (err) {
    console.error(`[mem-oracle] Failed to register session: ${err.message}`);
  }
  return null;
}

async function unregisterSessionWithWorker(sessionId) {
  try {
    const response = await fetch(`${WORKER_URL}/session/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      console.error(`[mem-oracle] Session unregistered: ${sessionId} (remaining: ${data.remainingSessions})`);
      return data;
    }
  } catch (err) {
    console.error(`[mem-oracle] Failed to unregister session: ${err.message}`);
  }
  return null;
}

async function getActiveSessionCount() {
  try {
    const response = await fetch(`${WORKER_URL}/sessions`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.count || 0;
    }
  } catch {}
  return 0;
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(join(DATA_DIR, "cache"), { recursive: true });
  await mkdir(join(DATA_DIR, "vectors"), { recursive: true });
}

async function startWorker() {
  let repoRoot = getRepoRoot();
  
  // Auto-clone if repo not found
  if (!repoRoot) {
    repoRoot = await cloneRepository();
    if (!repoRoot) {
      return false;
    }
  }
  
  const entryPoint = join(repoRoot, "src", "index.ts");

  if (!existsSync(entryPoint)) {
    console.error(`[mem-oracle] Entry point not found: ${entryPoint}`);
    console.error(`[mem-oracle] Repository may be corrupted. Try removing and re-cloning:`);
    console.error(`  rm -rf ~/.mem-oracle/repo && git clone ${REPO_URL} ~/.mem-oracle/repo`);
    return false;
  }

  await ensureDataDir();

  const logFd = openSync(LOG_FILE, "a");
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const installSource = pluginRoot ? "claude-code" : undefined;

  const child = spawn("bun", ["run", entryPoint, "worker"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      MEM_ORACLE_PORT: String(WORKER_PORT),
      MEM_ORACLE_DATA_DIR: DATA_DIR,
      ...(pluginRoot ? { MEM_ORACLE_PLUGIN_ROOT: pluginRoot } : {}),
      ...(installSource ? { MEM_ORACLE_INSTALL_SOURCE: installSource } : {}),
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
  let repoRoot = getRepoRoot();
  
  // Auto-clone if repo not found
  if (!repoRoot) {
    repoRoot = await cloneRepository();
    if (!repoRoot) {
      return false;
    }
  }
  
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
  const needsSessionState = ["start", "ensure", "stop-if-idle"].includes(command);
  
  if (needsSessionState) {
    await ensureDataDir();
  }

  switch (command) {
    case "start":
      await installDependencies();
      
      const clientType = getClientType();
      const sessionId = getSessionId(clientType);
      
      if (await isWorkerRunning()) {
        console.error("[mem-oracle] Worker already running");
        // Register this session with existing worker
        await registerSessionWithWorker(sessionId, clientType);
        return;
      }

      console.error("[mem-oracle] Starting worker service...");
      if (await startWorker()) {
        console.error("[mem-oracle] Worker started successfully on port " + WORKER_PORT);
        // Register this session with the new worker
        await registerSessionWithWorker(sessionId, clientType);
      } else {
        console.error("[mem-oracle] Failed to start worker. Check logs: " + LOG_FILE);
      }
      break;

    case "ensure":
      const ensureClientType = getClientType();
      const ensureSessionId = getSessionId(ensureClientType);
      
      if (!(await isWorkerRunning())) {
        console.error("[mem-oracle] Worker not running, starting...");
        if (await startWorker()) {
          await registerSessionWithWorker(ensureSessionId, ensureClientType);
        }
      } else {
        // Refresh session heartbeat
        await registerSessionWithWorker(ensureSessionId, ensureClientType);
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
      // Unregister this session and check if worker should stop
      if (!(await isWorkerRunning())) {
        console.error("[mem-oracle] Worker not running");
        return;
      }

      const stopClientType = getClientType();
      const stopSessionId = getSessionId(stopClientType);
      const unregisterResult = await unregisterSessionWithWorker(stopSessionId);
      
      // Check if other sessions are still connected
      if (unregisterResult && unregisterResult.remainingSessions > 0) {
        console.error(`[mem-oracle] ${unregisterResult.remainingSessions} other session(s) still active, keeping worker running`);
        return;
      }

      // No other sessions - proceed with shutdown logic
      if (!(await hasActivejobs())) {
        console.error("[mem-oracle] No active indexing and no other sessions, stopping worker...");
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
      // Background process - wait for indexing then stop (only if no sessions)
      if (!(await isWorkerRunning())) {
        return;
      }

      console.error("[mem-oracle] Background: waiting for indexing to complete...");
      const completed = await waitForIndexingComplete();
      
      if (completed) {
        // Re-check if there are still active sessions before stopping
        const remainingSessions = await getActiveSessionCount();
        if (remainingSessions > 0) {
          console.error(`[mem-oracle] Background: indexing complete but ${remainingSessions} session(s) still active, keeping worker running`);
          return;
        }
        
        console.error("[mem-oracle] Background: indexing complete and no active sessions, stopping worker...");
        await stopWorker();
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(console.error);
