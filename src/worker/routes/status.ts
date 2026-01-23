// Status route handler

import type { StatusResponse, StuckPageInfo } from "../../types";
import { getOrchestrator } from "../../crawler/orchestrator";

export async function handleStatus(url: URL): Promise<Response> {
  const docsetId = url.searchParams.get("docsetId");
  const includeStuck = url.searchParams.get("includeStuck") === "true";
  const orchestrator = getOrchestrator();
  
  const docsets = await orchestrator.listDocsets();
  const docsetsWithStatus = await Promise.all(
    docsets
      .filter(d => !docsetId || d.id === docsetId)
      .map(async d => {
        const indexStatus = await orchestrator.getIndexStatus(d.id);
        let stuckPages: StuckPageInfo[] | undefined;
        
        // Include stuck pages details when requested or when there are stuck pages
        if (includeStuck || indexStatus.stuckPages > 0) {
          stuckPages = await orchestrator.getStuckPages(d.id);
        }

        return {
          ...d,
          indexStatus,
          stuckPages,
        };
      })
  );

  const response: StatusResponse = {
    docsets: docsetsWithStatus,
  };

  return Response.json(response);
}
