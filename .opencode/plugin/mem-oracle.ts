/**
 * mem-oracle OpenCode Plugin
 * 
 * Documentation indexer that auto-injects relevant doc snippets into OpenCode context.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

const WORKER_PORT = parseInt(process.env.MEM_ORACLE_PORT || "7432");
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const DATA_DIR = process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle");
const PID_FILE = join(DATA_DIR, "worker.pid");
const LOG_FILE = join(DATA_DIR, "worker.log");
const TOP_K = parseInt(process.env.MEM_ORACLE_TOP_K || "5");
const AUTO_INDEX = process.env.MEM_ORACLE_AUTO_INDEX !== "false";

interface RetrieveResult {
  url: string;
  title: string;
  heading: string | null;
  content: string;
  score: number;
}

interface RetrieveResponse {
  results: RetrieveResult[];
}

interface IndexResponse {
  docsetId: string;
  status: string;
}

interface OpenCodeEvent {
  type: string;
  sessionID?: string;
  event?: {
    info?: {
      id?: string;
    };
  };
  [key: string]: unknown;
}

interface ToolInput {
  tool: string;
}

interface ToolOutput {
  args: Record<string, unknown>;
}

interface OpenCodePluginContext {
  project: { name?: string; path?: string };
  directory: string;
  worktree: string;
  client: unknown;
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

interface StatusResponse {
  docsets?: Array<{
    status?: string;
    indexStatus?: {
      pendingPages?: number;
      totalPages?: number;
    } | null;
  }>;
}

function getRepoRoot(): string {
  const pluginPath = new URL(import.meta.url).pathname;
  return dirname(dirname(dirname(pluginPath)));
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
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(join(DATA_DIR, "cache"), { recursive: true });
  await mkdir(join(DATA_DIR, "vectors"), { recursive: true });
}

async function installDependencies(): Promise<boolean> {
  const repoRoot = getRepoRoot();
  const nodeModules = join(repoRoot, "node_modules");

  if (existsSync(nodeModules)) {
    return true;
  }

  console.error("[mem-oracle] Installing dependencies...");

  try {
    const { execSync } = await import("child_process");
    execSync("bun install", { cwd: repoRoot, stdio: "inherit" });
    console.error("[mem-oracle] Dependencies installed successfully");
    return true;
  } catch (error) {
    console.error("[mem-oracle] Failed to install dependencies:", error);
    return false;
  }
}

async function startWorker(): Promise<boolean> {
  const repoRoot = getRepoRoot();
  const entryPoint = join(repoRoot, "src", "index.ts");

  if (!existsSync(entryPoint)) {
    console.error(`[mem-oracle] Entry point not found: ${entryPoint}`);
    return false;
  }

  await ensureDataDir();

  const { openSync, writeFileSync } = await import("fs");
  const logFd = openSync(LOG_FILE, "a");

  const child = spawn("bun", ["run", entryPoint, "worker"], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      MEM_ORACLE_PORT: String(WORKER_PORT),
      MEM_ORACLE_DATA_DIR: DATA_DIR,
      MEM_ORACLE_INSTALL_SOURCE: "opencode",
      MEM_ORACLE_PLUGIN_ROOT: repoRoot,
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

async function ensureWorkerRunning(): Promise<void> {
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

function getSessionIdFromEvent(event: OpenCodeEvent): string | null {
  if (typeof event.sessionID === "string") {
    return event.sessionID;
  }
  const infoId = event.event?.info?.id;
  if (typeof infoId === "string") {
    return infoId;
  }
  return null;
}

async function registerSessionWithWorker(sessionId: string): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/session/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, clientType: "opencode" }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Registration failed silently
  }
}

async function unregisterSessionWithWorker(sessionId: string): Promise<{ remainingSessions: number } | null> {
  try {
    const response = await fetch(`${WORKER_URL}/session/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { remainingSessions?: number };
      return { remainingSessions: data.remainingSessions ?? 0 };
    }
  } catch {
    // Unregister failed silently
  }
  return null;
}

async function getActiveSessionCount(): Promise<number> {
  try {
    const response = await fetch(`${WORKER_URL}/sessions`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json() as { count?: number };
      return data.count ?? 0;
    }
  } catch {
    // Ignore
  }
  return 0;
}

async function getIndexingStatus(): Promise<StatusResponse | null> {
  try {
    const response = await fetch(`${WORKER_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return await response.json() as StatusResponse;
    }
  } catch {
    // Status check failed silently
  }
  return null;
}

async function hasActiveIndexing(): Promise<boolean> {
  const status = await getIndexingStatus();
  if (!status?.docsets) {
    return false;
  }
  return status.docsets.some(docset => {
    if (docset.status !== "indexing") {
      return false;
    }
    const pendingPages = docset.indexStatus?.pendingPages ?? 0;
    return pendingPages > 0;
  });
}

async function stopWorker(): Promise<boolean> {
  if (!(await isWorkerRunning())) {
    return false;
  }
  if (!existsSync(PID_FILE)) {
    return false;
  }
  const pidText = readFileSync(PID_FILE, "utf-8").trim();
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isFinite(pid)) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
    writeFileSync(PID_FILE, "");
    return true;
  } catch {
    return false;
  }
}

async function stopWorkerIfIdle(sessionId: string): Promise<void> {
  const unregisterResult = await unregisterSessionWithWorker(sessionId);
  const remainingSessions = unregisterResult?.remainingSessions ?? await getActiveSessionCount();
  if (remainingSessions > 0) {
    return;
  }
  if (await hasActiveIndexing()) {
    return;
  }
  await stopWorker();
}

function parseDocUrl(input: string): { baseUrl: string; seedSlug: string } | null {
  const urlMatch = input.match(/https?:\/\/([^\/]+)(\/[^\s]*)?/);
  if (urlMatch) {
    return {
      baseUrl: `https://${urlMatch[1]}`,
      seedSlug: urlMatch[2] || "/",
    };
  }

  const docsMatch = input.match(/@docs?\s+([a-z0-9.-]+\.[a-z]+)\s*(\/[^\s]*)?/i);
  if (docsMatch && docsMatch[1]) {
    return {
      baseUrl: `https://${docsMatch[1]}`,
      seedSlug: docsMatch[2] || "/docs",
    };
  }

  return null;
}

async function triggerIndex(baseUrl: string, seedSlug: string): Promise<IndexResponse | null> {
  try {
    const response = await fetch(`${WORKER_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, seedSlug, waitForSeed: true }),
    });
    if (response.ok) {
      return response.json() as Promise<IndexResponse>;
    }
  } catch {
    // Indexing failed silently
  }
  return null;
}

async function retrieve(query: string, docsetIds?: string[]): Promise<RetrieveResponse | null> {
  try {
    const response = await fetch(`${WORKER_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, docsetIds, topK: TOP_K }),
    });
    if (response.ok) {
      return response.json() as Promise<RetrieveResponse>;
    }
  } catch {
    // Retrieval failed silently
  }
  return null;
}

function formatSnippets(results: RetrieveResult[]): string {
  if (results.length === 0) return "";

  const lines: string[] = ["## Relevant Documentation", ""];

  for (const result of results) {
    const source = result.heading
      ? `${result.title} > ${result.heading}`
      : result.title || result.url;

    lines.push(`### ${source}`);
    lines.push(`*Source: ${result.url}*`);
    lines.push("");
    lines.push(result.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

async function getRelevantDocs(query: string): Promise<string | null> {
  if (!(await isWorkerRunning())) {
    return null;
  }

  let docsetId: string | undefined;

  if (AUTO_INDEX) {
    const docUrl = parseDocUrl(query);
    if (docUrl) {
      const indexResult = await triggerIndex(docUrl.baseUrl, docUrl.seedSlug);
      if (indexResult) {
        docsetId = indexResult.docsetId;
      }
    }
  }

  const retrieveResult = await retrieve(query, docsetId ? [docsetId] : undefined);
  if (retrieveResult && retrieveResult.results.length > 0) {
    return formatSnippets(retrieveResult.results);
  }

  return null;
}

export const MemOraclePlugin = async (ctx: OpenCodePluginContext) => {
  console.error("[mem-oracle] Plugin initialized for:", ctx.project?.name || ctx.directory);

  await installDependencies();
  await ensureWorkerRunning();

  return {
    event: async ({ event }: { event: OpenCodeEvent }) => {
      const sessionId = getSessionIdFromEvent(event);
      
      if (event.type === "session.created" || event.type === "session.start") {
        console.error("[mem-oracle] Session started");
        await ensureWorkerRunning();
        if (sessionId) {
          await registerSessionWithWorker(sessionId);
        }
        return;
      }
      
      if (event.type === "session.deleted" || event.type === "session.end") {
        console.error("[mem-oracle] Session ended");
        if (sessionId) {
          await stopWorkerIfIdle(sessionId);
        }
        return;
      }
      
      if (sessionId) {
        await registerSessionWithWorker(sessionId);
      }
    },

    "tool.execute.before": async (input: ToolInput, output: ToolOutput) => {
      if (input.tool === "read" && typeof output.args.filePath === "string") {
        if (output.args.filePath.includes(".env")) {
          throw new Error("[mem-oracle] Protected: Cannot read .env files");
        }
      }
    },

    "tool.execute.after": async (_input: ToolInput, _output: ToolOutput, _result: unknown) => {
      // Hook for processing tool results
    },
  };
};

export default MemOraclePlugin;
