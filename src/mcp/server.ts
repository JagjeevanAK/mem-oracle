// MCP server for explicit tool calls via stdio

import type { SearchResult } from "../types";
import { getOrchestrator } from "../crawler/orchestrator";

interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: McpTool[] = [
  {
    name: "search_docs",
    description: "Search indexed documentation for relevant snippets",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant documentation snippets",
        },
        top_k: {
          type: "number",
          description: "Number of results to return (default: 5)",
        },
        docset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of docset IDs to search within",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_snippets",
    description: "Get documentation snippets by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        chunk_ids: {
          type: "array",
          items: { type: "string" },
          description: "List of chunk IDs to retrieve",
        },
      },
      required: ["chunk_ids"],
    },
  },
  {
    name: "index_docs",
    description: "Index a documentation website",
    inputSchema: {
      type: "object",
      properties: {
        base_url: {
          type: "string",
          description: "The base URL of the documentation site",
        },
        seed_slug: {
          type: "string",
          description: "The path to start indexing from",
        },
        name: {
          type: "string",
          description: "Optional name for the docset",
        },
        wait_for_seed: {
          type: "boolean",
          description: "Wait for seed page to be indexed before returning (default: true)",
        },
      },
      required: ["base_url", "seed_slug"],
    },
  },
  {
    name: "index_status",
    description: "Get the indexing status of documentation sites",
    inputSchema: {
      type: "object",
      properties: {
        docset_id: {
          type: "string",
          description: "Optional docset ID to get status for",
        },
      },
    },
  },
];

export class McpServer {
  private orchestrator = getOrchestrator();

  async handleRequest(request: McpRequest): Promise<McpResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case "initialize":
          return this.handleInitialize(id);
        
        case "tools/list":
          return this.handleToolsList(id);
        
        case "tools/call":
          return this.handleToolCall(id, params as { name: string; arguments: Record<string, unknown> });
        
        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
        },
      };
    }
  }

  private handleInitialize(id: string | number): McpResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "mem-oracle",
          version: "1.0.0",
        },
        capabilities: {
          tools: {},
        },
      },
    };
  }

  private handleToolsList(id: string | number): McpResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    };
  }

  private async handleToolCall(
    id: string | number,
    params: { name: string; arguments: Record<string, unknown> }
  ): Promise<McpResponse> {
    const { name, arguments: args } = params;

    switch (name) {
      case "search_docs":
        return this.handleSearchDocs(id, args);
      
      case "get_snippets":
        return this.handleGetSnippets(id, args);
      
      case "index_docs":
        return this.handleIndexDocs(id, args);
      
      case "index_status":
        return this.handleIndexStatus(id, args);
      
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        };
    }
  }

  private async handleSearchDocs(
    id: string | number,
    args: Record<string, unknown>
  ): Promise<McpResponse> {
    const query = args.query as string;
    const topK = (args.top_k as number) ?? 5;
    const docsetIds = args.docset_ids as string[] | undefined;

    const results = await this.orchestrator.search({
      query,
      topK,
      docsetIds,
    });

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: this.formatSearchResults(results),
          },
        ],
      },
    };
  }

  private async handleGetSnippets(
    id: string | number,
    args: Record<string, unknown>
  ): Promise<McpResponse> {
    const chunkIds = args.chunk_ids as string[];
    
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: `Requested ${chunkIds.length} chunk(s). Feature coming soon.`,
          },
        ],
      },
    };
  }

  private async handleIndexDocs(
    id: string | number,
    args: Record<string, unknown>
  ): Promise<McpResponse> {
    const baseUrl = args.base_url as string;
    const seedSlug = args.seed_slug as string;
    const name = args.name as string | undefined;
    const waitForSeed = (args.wait_for_seed as boolean) ?? true;

    const docset = await this.orchestrator.indexDocset(
      { baseUrl, seedSlug, name },
      waitForSeed
    );

    const status = await this.orchestrator.getIndexStatus(docset.id);

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: `Indexing started for ${docset.name} (${docset.baseUrl})\n` +
                  `Docset ID: ${docset.id}\n` +
                  `Status: ${docset.status}\n` +
                  `Pages indexed: ${status.indexedPages}/${status.totalPages}`,
          },
        ],
      },
    };
  }

  private async handleIndexStatus(
    id: string | number,
    args: Record<string, unknown>
  ): Promise<McpResponse> {
    const docsetId = args.docset_id as string | undefined;

    const docsets = await this.orchestrator.listDocsets();
    const filtered = docsetId 
      ? docsets.filter(d => d.id === docsetId)
      : docsets;

    const statusLines: string[] = [];

    for (const docset of filtered) {
      const status = await this.orchestrator.getIndexStatus(docset.id);
      statusLines.push(
        `**${docset.name}** (${docset.baseUrl})\n` +
        `  ID: ${docset.id}\n` +
        `  Status: ${status.status}\n` +
        `  Pages: ${status.indexedPages}/${status.totalPages} indexed, ${status.pendingPages} pending, ${status.errorPages} errors, ${status.skippedPages} skipped\n` +
        `  Chunks: ${status.totalChunks}`
      );
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: statusLines.length > 0 
              ? statusLines.join("\n\n")
              : "No docsets indexed yet.",
          },
        ],
      },
    };
  }

  private formatSearchResults(results: SearchResult[]): string {
    if (results.length === 0) {
      return "No relevant documentation found.";
    }

    const lines: string[] = [];

    for (const result of results) {
      const source = result.heading
        ? `${result.title} > ${result.heading}`
        : result.title || result.url;

      lines.push(`### ${source}`);
      lines.push(`*Source: ${result.url}*`);
      lines.push(`*Relevance: ${(result.score * 100).toFixed(1)}%*`);
      lines.push("");
      lines.push(result.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }
}

export async function startMcpServer() {
  const server = new McpServer();
  const encoder = new TextEncoder();

  console.error("mem-oracle MCP server started");

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        const response = await server.handleRequest(request);
        const responseStr = JSON.stringify(response) + "\n";
        await Bun.write(Bun.stdout, encoder.encode(responseStr));
      } catch (error) {
        console.error("Failed to process request:", error);
      }
    }
  }
}

if (import.meta.main) {
  startMcpServer().catch(console.error);
}
