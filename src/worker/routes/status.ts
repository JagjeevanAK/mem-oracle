// Status route handler

import type { StatusResponse } from "../../types";
import { getOrchestrator } from "../../crawler/orchestrator";

export async function handleStatus(url: URL): Promise<Response> {
  const docsetId = url.searchParams.get("docsetId");
  const orchestrator = getOrchestrator();
  
  const docsets = await orchestrator.listDocsets();
  const docsetsWithStatus = await Promise.all(
    docsets
      .filter(d => !docsetId || d.id === docsetId)
      .map(async d => ({
        ...d,
        indexStatus: await orchestrator.getIndexStatus(d.id),
      }))
  );

  const response: StatusResponse = {
    docsets: docsetsWithStatus,
  };

  return Response.json(response);
}
