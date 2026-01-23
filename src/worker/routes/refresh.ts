// Refresh/re-index documentation route handler

import { getOrchestrator } from "../../crawler/orchestrator";
import { getMetadataStore } from "../../storage/metadata";

interface RefreshRequest {
  docsetId?: string;
  baseUrl?: string;
  force?: boolean;
  maxAge?: number; // Max age in hours before refresh is needed
  /** If true, discard content hashes and re-embed everything (ignores incremental optimization) */
  fullReindex?: boolean;
}

interface RefreshResponse {
  docsetId: string;
  status: string;
  refreshed: boolean;
  message: string;
  /** Stats about the incremental reindex (populated after crawl completes) */
  incremental?: {
    preservedHashes: number;
    clearedHashes: number;
  };
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
  // By default, preserve contentHash/etag/lastModified for incremental checking
  // Only clear them if fullReindex is requested
  const pages = await metadataStore.listPages(docset.id);
  let preservedHashes = 0;
  let clearedHashes = 0;
  
  for (const page of pages) {
    const hadHash = page.contentHash !== null;
    
    if (body.fullReindex) {
      // Full reindex: clear everything including content hash
      await metadataStore.updatePage(page.id, {
        status: "pending",
        fetchedAt: null,
        indexedAt: null,
        contentHash: null,
        etag: null,
        lastModified: null,
      });
      // Delete existing chunks for full reindex
      await metadataStore.deleteChunks(page.id);
      if (hadHash) clearedHashes++;
    } else {
      // Incremental reindex: preserve contentHash/etag/lastModified
      // Don't delete chunks - they'll be preserved if content is unchanged
      await metadataStore.updatePage(page.id, {
        status: "pending",
      });
      if (hadHash) preservedHashes++;
    }
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

  const incrementalMode = body.fullReindex ? "full" : "incremental";
  const response: RefreshResponse = {
    docsetId: updatedDocset.id,
    status: updatedDocset.status,
    refreshed: true,
    message: `Refreshing ${pages.length} pages from ${docset.name} (${incrementalMode} mode)`,
    incremental: {
      preservedHashes,
      clearedHashes,
    },
  };

  return Response.json(response);
}

export async function handleRefreshAll(req: Request): Promise<Response> {
  const body = await req.json() as { force?: boolean; maxAge?: number; fullReindex?: boolean };
  
  const metadataStore = getMetadataStore();
  const orchestrator = getOrchestrator();
  const docsets = await metadataStore.listDocsets();
  
  const maxAgeMs = (body.maxAge ?? DEFAULT_MAX_AGE_HOURS) * 60 * 60 * 1000;
  const results: RefreshResponse[] = [];

  for (const docset of docsets) {
    const isStale = Date.now() - docset.updatedAt > maxAgeMs;
    
    if (body.force || isStale) {
      // Reset pages for re-indexing with incremental optimization
      const pages = await metadataStore.listPages(docset.id);
      let preservedHashes = 0;
      let clearedHashes = 0;
      
      for (const page of pages) {
        const hadHash = page.contentHash !== null;
        
        if (body.fullReindex) {
          await metadataStore.updatePage(page.id, {
            status: "pending",
            fetchedAt: null,
            indexedAt: null,
            contentHash: null,
            etag: null,
            lastModified: null,
          });
          await metadataStore.deleteChunks(page.id);
          if (hadHash) clearedHashes++;
        } else {
          // Incremental: preserve hashes for unchanged content detection
          await metadataStore.updatePage(page.id, {
            status: "pending",
          });
          if (hadHash) preservedHashes++;
        }
      }

      await metadataStore.updateDocset(docset.id, { status: "pending" });
      
      // Start background crawl for this docset
      orchestrator.resumeBackgroundCrawl(docset.id);

      const incrementalMode = body.fullReindex ? "full" : "incremental";
      results.push({
        docsetId: docset.id,
        status: "pending",
        refreshed: true,
        message: `Queued ${pages.length} pages for refresh (${incrementalMode})`,
        incremental: {
          preservedHashes,
          clearedHashes,
        },
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
