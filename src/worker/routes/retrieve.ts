// Retrieve/search route handler

import type { RetrieveRequest, RetrieveResponse, EnhancedSearchResult } from "../../types";
import { getOrchestrator } from "../../crawler/orchestrator";

export async function handleRetrieve(req: Request): Promise<Response> {
  const body = await req.json() as RetrieveRequest;
  
  if (!body.query) {
    return Response.json(
      { error: "query is required" },
      { status: 400 }
    );
  }

  const orchestrator = getOrchestrator();
  
  const results = await orchestrator.search({
    query: body.query,
    docsetIds: body.docsetIds,
    topK: body.topK ?? 5,
    maxChunksPerPage: body.maxChunksPerPage,
    maxTotalChars: body.maxTotalChars,
    formatSnippets: body.formatSnippets,
  });

  // Calculate total chars and check if truncated
  const totalChars = calculateTotalChars(results);
  const requestedBudget = body.maxTotalChars;
  const truncated = requestedBudget !== undefined && totalChars >= requestedBudget * 0.95;

  const response: RetrieveResponse = {
    results,
    query: body.query,
    totalChars,
    truncated,
  };

  return Response.json(response);
}

function calculateTotalChars(results: EnhancedSearchResult[]): number {
  return results.reduce((sum, r) => {
    return sum + (r.snippet?.charCount ?? r.content.length);
  }, 0);
}
