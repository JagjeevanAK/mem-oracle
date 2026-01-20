#!/usr/bin/env bun

const WORKER_URL = process.env.MEM_ORACLE_WORKER_URL || "http://127.0.0.1:7432";
const TOP_K = parseInt(process.env.MEM_ORACLE_TOP_K || "5");
const AUTO_INDEX = process.env.MEM_ORACLE_AUTO_INDEX !== "false";

interface HookInput {
  prompt: string;
  session_id?: string;
}

interface HookOutput {
  context?: string;
}

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
    // Indexing failed
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
    // Retrieval failed
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

async function main() {
  const input: HookInput = JSON.parse(await Bun.stdin.text());
  const output: HookOutput = {};

  if (!(await isWorkerRunning())) {
    console.log(JSON.stringify(output));
    return;
  }

  const { prompt } = input;
  let docsetId: string | undefined;

  if (AUTO_INDEX) {
    const docUrl = parseDocUrl(prompt);
    if (docUrl) {
      const indexResult = await triggerIndex(docUrl.baseUrl, docUrl.seedSlug);
      if (indexResult) {
        docsetId = indexResult.docsetId;
      }
    }
  }

  const retrieveResult = await retrieve(prompt, docsetId ? [docsetId] : undefined);
  if (retrieveResult && retrieveResult.results.length > 0) {
    output.context = formatSnippets(retrieveResult.results);
  }

  console.log(JSON.stringify(output));
}

main().catch(console.error);
