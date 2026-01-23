// Pages listing route handler

import type { ListPagesResponse, PageRecord, PageSummary } from "../../types";
import { getMetadataStore } from "../../storage/metadata";

export async function handleListPages(docsetId: string, url: URL): Promise<Response> {
  if (!docsetId) {
    return Response.json(
      { error: "docsetId is required" },
      { status: 400 }
    );
  }

  const statusParam = url.searchParams.get("status") as PageRecord["status"] | null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const metadataStore = getMetadataStore();
  const docset = await metadataStore.getDocset(docsetId);

  if (!docset) {
    return Response.json(
      { error: "Docset not found" },
      { status: 404 }
    );
  }

  const allPages = await metadataStore.listPages(docsetId, statusParam || undefined);

  const paginatedPages = allPages.slice(offset, offset + limit);

  const pageSummaries: PageSummary[] = paginatedPages.map(page => ({
    id: page.id,
    url: page.url,
    path: page.path,
    title: page.title,
    status: page.status,
    errorMessage: page.errorMessage,
    fetchedAt: page.fetchedAt,
    indexedAt: page.indexedAt,
  }));

  const response: ListPagesResponse = {
    pages: pageSummaries,
    total: allPages.length,
    limit,
    offset,
  };

  return Response.json(response);
}
