// Index documentation route handler

import type { IndexRequest, IndexResponse } from "../../types";
import { getOrchestrator } from "../../crawler/orchestrator";

export async function handleIndexDocs(req: Request): Promise<Response> {
  const body = await req.json() as IndexRequest;
  
  if (!body.baseUrl || !body.seedSlug) {
    return Response.json(
      { error: "baseUrl and seedSlug are required" },
      { status: 400 }
    );
  }

  const orchestrator = getOrchestrator();
  
  const docset = await orchestrator.indexDocset(
    {
      baseUrl: body.baseUrl,
      seedSlug: body.seedSlug,
      name: body.name,
      allowedPaths: body.allowedPaths,
    },
    body.waitForSeed ?? true
  );

  const status = await orchestrator.getIndexStatus(docset.id);

  const response: IndexResponse = {
    docsetId: docset.id,
    status: docset.status,
    seedIndexed: status.indexedPages > 0,
  };

  return Response.json(response);
}
