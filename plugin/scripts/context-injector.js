#!/usr/bin/env bun
/**
 * UserPromptSubmit hook handler.
 * Reads the prompt from stdin, retrieves relevant docs, and outputs context.
 */

import { appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const WORKER_PORT = parseInt(process.env.MEM_ORACLE_PORT || "7432");
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const LOG_FILE = join(process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle"), "injection.log");

function log(msg) {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
  } catch {}
}

const DEFAULT_TOP_K = 4;
const MAX_SNIPPET_CHARS = 600;
const MAX_TOTAL_CHARS = 2400;
const MIN_KEYWORD_LENGTH = 4;
const STOPWORDS = new Set([
  "with", "from", "that", "this", "there", "their", "about", "into", "your",
  "where", "what", "when", "which", "will", "would", "could", "should", "have",
  "been", "being", "were", "they", "them", "then", "than", "also", "just",
  "init", "initialize", "setup", "start", "project", "using", "need",
]);

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

async function fetchJson(path, body) {
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return response.json();
}

function trimSnippet(content) {
  if (!content) return "";
  if (content.length <= MAX_SNIPPET_CHARS) return content;
  return content.slice(0, MAX_SNIPPET_CHARS).trim() + "...";
}

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= MIN_KEYWORD_LENGTH)
    .filter((word) => !STOPWORDS.has(word));
}

function extractTokens(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= 2);
}

function getDocsetTokens(docset) {
  const tokens = new Set();
  
  // Extract from docset name (e.g., "www.prisma.io" -> ["www", "prisma", "io"])
  for (const token of extractTokens(docset.name)) {
    tokens.add(token);
  }
  
  // Extract from baseUrl hostname (e.g., "https://www.prisma.io" -> ["www", "prisma", "io"])
  try {
    const url = new URL(docset.baseUrl);
    for (const token of extractTokens(url.hostname)) {
      tokens.add(token);
    }
  } catch {}
  
  return tokens;
}

function getRelevantDocsets(prompt, docsets) {
  const promptTokens = new Set(extractTokens(prompt));
  const matched = [];
  
  for (const docset of docsets) {
    const docsetTokens = getDocsetTokens(docset);
    let hasMatch = false;
    
    for (const token of docsetTokens) {
      // Check if any prompt token contains or matches the docset token
      for (const promptToken of promptTokens) {
        if (promptToken.includes(token) || token.includes(promptToken)) {
          hasMatch = true;
          break;
        }
      }
      if (hasMatch) break;
    }
    
    if (hasMatch) {
      matched.push(docset);
    }
  }
  
  return matched;
}

function scoreOverlap(text, keywords) {
  if (!text || keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of keywords) {
    if (lower.includes(word)) score += 1;
  }
  return score;
}

function rerankResults(results, keywords) {
  if (!keywords.length) return results;
  const scored = results.map((item) => {
    const titleScore = scoreOverlap(item.title || "", keywords) * 3;
    const headingScore = scoreOverlap(item.heading || "", keywords) * 2;
    const urlScore = scoreOverlap(item.url || "", keywords);
    const contentScore = scoreOverlap(item.content || "", keywords);
    const keywordScore = titleScore + headingScore + urlScore + contentScore;
    return {
      ...item,
      _keywordScore: keywordScore,
    };
  });
  const filtered = scored.filter((item) => item._keywordScore > 0);
  const base = filtered.length > 0 ? filtered : scored;
  return base.sort((a, b) => {
    if (b._keywordScore !== a._keywordScore) {
      return b._keywordScore - a._keywordScore;
    }
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function formatResults(query, results, docsetMap) {
  const lines = [];
  
  // Two-pass format: Retrieved context first
  lines.push("=== RETRIEVED DOCUMENTATION CONTEXT ===");
  lines.push("The following snippets were retrieved from indexed documentation.");
  lines.push("Use this context to answer the user's question accurately.");
  lines.push("");
  
  if (docsetMap && docsetMap.size > 0) {
    const sources = Array.from(docsetMap.values())
      .map((d) => `${d.name} (${d.baseUrl})`)
      .join(", ");
    lines.push(`Sources: ${sources}`);
    lines.push("");
  }

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const title = item.title || item.heading || "Untitled";
    const snippet = trimSnippet(item.content);

    lines.push(`--- Snippet ${i + 1}: ${title} ---`);
    if (docsetMap && docsetMap.has(item.docsetId)) {
      const docset = docsetMap.get(item.docsetId);
      lines.push(`Docset: ${docset.name}`);
    }
    lines.push(`URL: ${item.url}`);
    if (item.heading) lines.push(`Section: ${item.heading}`);
    lines.push("");
    lines.push(snippet);
    lines.push("");
  }

  // Two-pass format: Original prompt reminder
  lines.push("=== ORIGINAL USER PROMPT ===");
  lines.push(query);
  lines.push("");
  lines.push("=== INSTRUCTIONS ===");
  lines.push("Answer the user's prompt using the retrieved documentation context above.");
  lines.push("Prefer the retrieved snippets over your prior knowledge when they are relevant.");
  lines.push("If the snippets don't contain relevant information, you may use your knowledge but note that the docs were checked.");

  let output = lines.join("\n").trim();
  if (output.length > MAX_TOTAL_CHARS) {
    output = output.slice(0, MAX_TOTAL_CHARS).trim() + "...";
  }
  return output;
}

function buildHookOutput(additionalContext) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  });
}

async function main() {
  log("=== Injection hook triggered ===");
  
  const rawInput = await readStdin();
  const payload = safeJsonParse(rawInput) || {};
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";

  if (!prompt) {
    log("No prompt found, exiting");
    process.exit(0);
  }
  
  log(`Prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"`);

  const status = await fetchJson("/status");
  if (!status || !Array.isArray(status.docsets)) {
    log("Worker not available or no docsets");
    process.exit(0);
  }

  const readyDocsets = status.docsets.filter((d) => d.status === "ready");
  if (readyDocsets.length === 0) {
    log("No ready docsets found");
    process.exit(0);
  }
  
  log(`Found ${readyDocsets.length} ready docset(s): ${readyDocsets.map(d => d.name).join(", ")}`);

  // Conditional retrieval: only query docsets that match the prompt
  const matchedDocsets = getRelevantDocsets(prompt, readyDocsets);
  
  if (matchedDocsets.length === 0) {
    log("No docset match; skipping retrieval");
    process.exit(0);
  }
  
  log(`Matched ${matchedDocsets.length} docset(s): ${matchedDocsets.map(d => d.name).join(", ")}`);

  const docsetMap = new Map(matchedDocsets.map((d) => [d.id, { name: d.name, baseUrl: d.baseUrl }]));
  const docsetIds = matchedDocsets.map((d) => d.id);
  const topK = DEFAULT_TOP_K;

  const retrieve = await fetchJson("/retrieve", {
    query: prompt,
    docsetIds,
    topK,
  });

  if (!retrieve || !Array.isArray(retrieve.results) || retrieve.results.length === 0) {
    log("No relevant results found for prompt");
    process.exit(0);
  }
  
  const keywords = extractKeywords(prompt);
  const reranked = rerankResults(retrieve.results, keywords).slice(0, topK);
  log(`Keywords: ${keywords.join(", ") || "none"}`);
  log(`Injecting ${reranked.length} snippet(s)`);

  const output = formatResults(prompt, reranked, docsetMap);
  if (output) {
    log(`Output length: ${output.length} chars`);
    const hookOutput = buildHookOutput(output);
    log(`JSON output length: ${hookOutput.length} chars`);
    process.stdout.write(hookOutput);
  }
}

main().catch(() => process.exit(0));
