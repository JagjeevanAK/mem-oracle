// Retrieve/search route handler

import type { RetrieveRequest, RetrieveResponse } from "../../types";
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
  });

  const response: RetrieveResponse = {
    results,
    query: body.query,
  };

  return Response.json(response);
}
