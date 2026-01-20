// Docset management route handlers

import { getOrchestrator } from "../../crawler/orchestrator";

export async function handleDeleteDocset(docsetId: string): Promise<Response> {
  if (!docsetId) {
    return Response.json(
      { error: "docsetId is required" },
      { status: 400 }
    );
  }

  const orchestrator = getOrchestrator();
  await orchestrator.deleteDocset(docsetId);
  
  return Response.json({ success: true, docsetId });
}

export async function handleGetDocset(docsetId: string): Promise<Response> {
  if (!docsetId) {
    return Response.json(
      { error: "docsetId is required" },
      { status: 400 }
    );
  }

  const orchestrator = getOrchestrator();
  const docsets = await orchestrator.listDocsets();
  const docset = docsets.find(d => d.id === docsetId);
  
  if (!docset) {
    return Response.json(
      { error: "Docset not found" },
      { status: 404 }
    );
  }

  const indexStatus = await orchestrator.getIndexStatus(docsetId);
  
  return Response.json({ ...docset, indexStatus });
}
