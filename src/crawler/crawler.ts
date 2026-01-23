// Link crawler - discovers and queues pages for indexing within allowed paths

import type { PageRecord, DocsetRecord } from "../types";
import { getMetadataStore } from "../storage/metadata";

interface CrawlQueueItem {
  url: string;
  depth: number;
  fromUrl: string | null;
}

export class LinkCrawler {
  private queue: CrawlQueueItem[] = [];
  private visited: Set<string> = new Set();
  private maxPages: number;
  private maxDepth: number;

  constructor(options?: { maxPages?: number; maxDepth?: number }) {
    this.maxPages = options?.maxPages ?? 1000;
    this.maxDepth = options?.maxDepth ?? 10;
  }

  async discoverLinks(
    docset: DocsetRecord,
    pageUrl: string,
    links: string[],
    currentDepth: number
  ): Promise<number> {
    const metadataStore = getMetadataStore();
    let addedCount = 0;

    const baseUrlObj = new URL(docset.baseUrl);
    const allowedPaths = docset.allowedPaths;

    for (const link of links) {
      if (this.visited.has(link)) continue;

      try {
        const linkUrl = new URL(link);
        
        if (linkUrl.hostname !== baseUrlObj.hostname) continue;

        const isAllowed = allowedPaths.some(prefix => 
          linkUrl.pathname.startsWith(prefix)
        );
        if (!isAllowed) continue;

        const existingPage = await metadataStore.getPageByUrl(docset.id, link);
        if (existingPage) {
          this.visited.add(link);
          continue;
        }

        const currentPages = await metadataStore.listPages(docset.id);
        if (currentPages.length >= this.maxPages) {
          console.log(`Max pages limit (${this.maxPages}) reached for docset ${docset.id}`);
          return addedCount;
        }

        this.queue.push({
          url: link,
          depth: currentDepth + 1,
          fromUrl: pageUrl,
        });
        this.visited.add(link);

        await metadataStore.createPage({
          docsetId: docset.id,
          url: link,
          path: linkUrl.pathname,
          title: null,
          contentHash: null,
          fetchedAt: null,
          indexedAt: null,
          status: "pending",
          errorMessage: null,
          etag: null,
          lastModified: null,
          retryCount: 0,
          lastAttemptAt: null,
        });

        addedCount++;
      } catch {
        // Invalid URL, skip
      }
    }

    return addedCount;
  }

  getNext(): CrawlQueueItem | undefined {
    this.queue.sort((a, b) => a.depth - b.depth);
    return this.queue.shift();
  }

  hasMore(): boolean {
    return this.queue.length > 0;
  }

  queueLength(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.visited.clear();
  }

  markVisited(url: string): void {
    this.visited.add(url);
  }

  async loadPendingPages(docsetId: string): Promise<void> {
    const metadataStore = getMetadataStore();
    const pendingPages = await metadataStore.listPages(docsetId, "pending");

    for (const page of pendingPages) {
      if (!this.visited.has(page.url)) {
        this.queue.push({
          url: page.url,
          depth: 1,
          fromUrl: null,
        });
        this.visited.add(page.url);
      }
    }
  }
}

export function createLinkCrawler(options?: { maxPages?: number; maxDepth?: number }): LinkCrawler {
  return new LinkCrawler(options);
}
