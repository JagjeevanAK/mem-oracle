// Claude Code plugin hooks for worker integration

import type { RetrieveResponse, IndexResponse, StatusResponse } from "../types";

const DEFAULT_WORKER_URL = "http://127.0.0.1:7432";

interface HookConfig {
  workerUrl?: string;
  topK?: number;
  autoIndex?: boolean;
}

function getWorkerUrl(): string {
  return process.env.MEM_ORACLE_WORKER_URL || DEFAULT_WORKER_URL;
}

export async function isWorkerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${getWorkerUrl()}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function triggerIndex(
  baseUrl: string,
  seedSlug: string,
  options?: { name?: string; allowedPaths?: string[]; waitForSeed?: boolean }
): Promise<IndexResponse> {
  const workerUrl = getWorkerUrl();
  
  const response = await fetch(`${workerUrl}/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl,
      seedSlug,
      name: options?.name,
      allowedPaths: options?.allowedPaths,
      waitForSeed: options?.waitForSeed ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<IndexResponse>;
}

export async function retrieve(
  query: string,
  options?: { docsetIds?: string[]; topK?: number }
): Promise<RetrieveResponse> {
  const workerUrl = getWorkerUrl();
  
  const response = await fetch(`${workerUrl}/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      docsetIds: options?.docsetIds,
      topK: options?.topK ?? 5,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<RetrieveResponse>;
}

export async function getStatus(docsetId?: string): Promise<StatusResponse> {
  const workerUrl = getWorkerUrl();
  const url = docsetId 
    ? `${workerUrl}/status?docsetId=${encodeURIComponent(docsetId)}`
    : `${workerUrl}/status`;
  
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<StatusResponse>;
}

export function formatSnippetsForContext(results: RetrieveResponse["results"]): string {
  if (results.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## Relevant Documentation Snippets",
    "",
  ];

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

export function parseDocUrl(input: string): { baseUrl: string; seedSlug: string } | null {
  const urlMatch = input.match(/https?:\/\/([^\/]+)(\/[^\s]*)?/);
  if (urlMatch) {
    const host = urlMatch[1];
    const path = urlMatch[2] || "/";
    return {
      baseUrl: `https://${host}`,
      seedSlug: path,
    };
  }

  const hostPathMatch = input.match(/^([a-z0-9.-]+\.[a-z]+)(\/[^\s]*)?$/i);
  if (hostPathMatch) {
    const host = hostPathMatch[1];
    const path = hostPathMatch[2] || "/";
    return {
      baseUrl: `https://${host}`,
      seedSlug: path,
    };
  }

  const docsMatch = input.match(/@docs?\s+([a-z0-9.-]+\.[a-z]+)\s+(\/[^\s]*)/i);
  if (docsMatch && docsMatch[1] && docsMatch[2]) {
    return {
      baseUrl: `https://${docsMatch[1]}`,
      seedSlug: docsMatch[2],
    };
  }

  return null;
}

export function detectDocIntent(prompt: string): { baseUrl: string; seedSlug: string } | null {
  const parsed = parseDocUrl(prompt);
  if (parsed) {
    return parsed;
  }

  const docsCommand = prompt.match(/@docs?\s+(\S+)/i);
  if (docsCommand && docsCommand[1]) {
    return parseDocUrl(docsCommand[1]);
  }

  return null;
}

export async function prePromptHook(
  prompt: string,
  config?: HookConfig
): Promise<{ injectedContext: string; docsetId?: string }> {
  const running = await isWorkerRunning();
  if (!running) {
    return { injectedContext: "" };
  }

  const docIntent = detectDocIntent(prompt);
  let docsetId: string | undefined;

  if (docIntent && config?.autoIndex !== false) {
    try {
      const indexResult = await triggerIndex(docIntent.baseUrl, docIntent.seedSlug);
      docsetId = indexResult.docsetId;
    } catch (error) {
      console.error("Failed to index docs:", error);
    }
  }

  try {
    const retrieveResult = await retrieve(prompt, {
      docsetIds: docsetId ? [docsetId] : undefined,
      topK: config?.topK ?? 5,
    });

    if (retrieveResult.results.length > 0) {
      return {
        injectedContext: formatSnippetsForContext(retrieveResult.results),
        docsetId,
      };
    }
  } catch (error) {
    console.error("Failed to retrieve snippets:", error);
  }

  return { injectedContext: "", docsetId };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "health": {
      const running = await isWorkerRunning();
      console.log(running ? "Worker is running" : "Worker is not running");
      break;
    }

    case "index": {
      const indexUrl = args[1];
      if (!indexUrl) {
        console.error("Usage: hooks index <url>");
        process.exit(1);
      }
      const parsedUrl = parseDocUrl(indexUrl);
      if (!parsedUrl) {
        console.error("Invalid URL format");
        process.exit(1);
      }
      const result = await triggerIndex(parsedUrl.baseUrl, parsedUrl.seedSlug);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "retrieve": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: hooks retrieve <query>");
        process.exit(1);
      }
      const result = await retrieve(query);
      console.log(formatSnippetsForContext(result.results));
      break;
    }

    case "status": {
      const result = await getStatus(args[1]);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log("Usage: hooks <command> [args]");
      console.log("Commands:");
      console.log("  health              Check if worker is running");
      console.log("  index <url>         Index a documentation site");
      console.log("  retrieve <query>    Retrieve relevant snippets");
      console.log("  status [docsetId]   Get indexing status");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
