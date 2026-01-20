// Refresh/re-index documentation route handler

import { getOrchestrator } from "../../crawler/orchestrator";
import { getMetadataStore } from "../../storage/metadata";

interface RefreshRequest {
  docsetId?: string;
  baseUrl?: string;
  force?: boolean;
  maxAge?: number; // Max age in hours before refresh is needed
}

interface RefreshResponse {
  docsetId: string;
  status: string;
  refreshed: boolean;
  message: string;
}

const DEFAULT_MAX_AGE_HOURS = 24;

export async function handleRefresh(req: Request): Promise<Response> {
  const body = await req.json() as RefreshRequest;
  
  if (!body.docsetId && !body.baseUrl) {
    return Response.json(
      { error: "docsetId or baseUrl is required" },
      { status: 400 }
    );
  }

  const metadataStore = getMetadataStore();
  const orchestrator = getOrchestrator();
  
  let docset;
  
  if (body.docsetId) {
    docset = await metadataStore.getDocset(body.docsetId);
  } else if (body.baseUrl) {
    docset = await metadataStore.getDocsetByUrl(body.baseUrl);
  }

  if (!docset) {
    return Response.json(
      { error: "Docset not found" },
      { status: 404 }
    );
  }

  const maxAgeMs = (body.maxAge ?? DEFAULT_MAX_AGE_HOURS) * 60 * 60 * 1000;
  const isStale = Date.now() - docset.updatedAt > maxAgeMs;
  const shouldRefresh = body.force || isStale;

  if (!shouldRefresh) {
    const response: RefreshResponse = {
      docsetId: docset.id,
      status: docset.status,
      refreshed: false,
      message: `Docset is fresh (updated ${formatAge(docset.updatedAt)}). Use force=true to refresh anyway.`,
    };
    return Response.json(response);
  }

  // Reset all pages to pending status for re-indexing
  const pages = await metadataStore.listPages(docset.id);
  
  for (const page of pages) {
    await metadataStore.updatePage(page.id, {
      status: "pending",
      fetchedAt: null,
      indexedAt: null,
    });
    // Delete existing chunks for this page
    await metadataStore.deleteChunks(page.id);
  }

  // Update docset status
  await metadataStore.updateDocset(docset.id, { status: "pending" });

  // Trigger re-indexing
  const updatedDocset = await orchestrator.indexDocset(
    {
      id: docset.id,
      baseUrl: docset.baseUrl,
      seedSlug: docset.seedSlug,
      allowedPaths: docset.allowedPaths,
    },
    true // wait for seed
  );

  const response: RefreshResponse = {
    docsetId: updatedDocset.id,
    status: updatedDocset.status,
    refreshed: true,
    message: `Refreshing ${pages.length} pages from ${docset.name}`,
  };

  return Response.json(response);
}

export async function handleRefreshAll(req: Request): Promise<Response> {
  const body = await req.json() as { force?: boolean; maxAge?: number };
  
  const metadataStore = getMetadataStore();
  const docsets = await metadataStore.listDocsets();
  
  const maxAgeMs = (body.maxAge ?? DEFAULT_MAX_AGE_HOURS) * 60 * 60 * 1000;
  const results: RefreshResponse[] = [];

  for (const docset of docsets) {
    const isStale = Date.now() - docset.updatedAt > maxAgeMs;
    
    if (body.force || isStale) {
      // Reset pages for re-indexing
      const pages = await metadataStore.listPages(docset.id);
      
      for (const page of pages) {
        await metadataStore.updatePage(page.id, {
          status: "pending",
          fetchedAt: null,
          indexedAt: null,
        });
        await metadataStore.deleteChunks(page.id);
      }

      await metadataStore.updateDocset(docset.id, { status: "pending" });

      results.push({
        docsetId: docset.id,
        status: "pending",
        refreshed: true,
        message: `Queued ${pages.length} pages for refresh`,
      });
    } else {
      results.push({
        docsetId: docset.id,
        status: docset.status,
        refreshed: false,
        message: `Fresh (updated ${formatAge(docset.updatedAt)})`,
      });
    }
  }

  return Response.json({
    total: docsets.length,
    refreshed: results.filter(r => r.refreshed).length,
    results,
  });
}

function formatAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  
  if (hours < 1) {
    const mins = Math.floor(ageMs / (60 * 1000));
    return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  }
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}
