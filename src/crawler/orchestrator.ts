// Indexer orchestrator - coordinates the fetch/extract/chunk/embed pipeline

import { createHash } from "crypto";
import type {
  DocsetInput,
  DocsetRecord,
  PageRecord,
  EmbeddingVector,
  SearchQuery,
  SearchResult,
  KeywordSearchResult,
  StuckPageInfo,
  EnhancedSearchResult,
  FormattedSnippet,
  RetrievalConfig,
} from "../types";
import { getMetadataStore, SQLiteMetadataStore } from "../storage/metadata";
import { getVectorStore, LocalVectorStore } from "../storage/vector-store";
import { getHttpFetcher, HttpFetcher } from "./fetcher";
import { getDocExtractor, DocExtractor } from "./extractor";
import { getTextChunker, TextChunker } from "./chunker";
import { createLinkCrawler, LinkCrawler } from "./crawler";
import { getEmbeddingProvider } from "../embedding";
import { loadConfig } from "../config";
import type { EmbeddingProvider } from "../types";

interface IndexerOptions {
  metadataStore?: SQLiteMetadataStore;
  vectorStore?: LocalVectorStore;
  fetcher?: HttpFetcher;
  extractor?: DocExtractor;
  chunker?: TextChunker;
  embeddingProvider?: EmbeddingProvider;
  crawlerOptions?: { maxPages?: number; maxDepth?: number };
}

interface CrawlRunnerState {
  inFlight: number;
  nextAllowedFetchAt: number;
  stopRequested: boolean;
  runningPromise: Promise<void> | null;
}

export class IndexerOrchestrator {
  private metadataStore: SQLiteMetadataStore;
  private vectorStore: LocalVectorStore;
  private fetcher: HttpFetcher;
  private extractor: DocExtractor;
  private chunker: TextChunker;
  private embeddingProvider: EmbeddingProvider | null = null;
  private crawlers: Map<string, LinkCrawler> = new Map();
  private crawlerOptions: { maxPages?: number; maxDepth?: number };
  private runnerStates: Map<string, CrawlRunnerState> = new Map();

  constructor(options?: IndexerOptions) {
    this.metadataStore = options?.metadataStore ?? getMetadataStore();
    this.vectorStore = options?.vectorStore ?? getVectorStore();
    this.fetcher = options?.fetcher ?? getHttpFetcher();
    this.extractor = options?.extractor ?? getDocExtractor();
    this.chunker = options?.chunker ?? getTextChunker();
    this.embeddingProvider = options?.embeddingProvider ?? null;
    this.crawlerOptions = options?.crawlerOptions ?? {};
  }

  private async getEmbeddingProvider(): Promise<EmbeddingProvider> {
    if (!this.embeddingProvider) {
      this.embeddingProvider = await getEmbeddingProvider();
    }
    return this.embeddingProvider;
  }

  async indexDocset(input: DocsetInput, waitForSeed = true): Promise<DocsetRecord> {
    let docset = await this.metadataStore.getDocsetByUrl(input.baseUrl);
    
    if (!docset) {
      docset = await this.metadataStore.createDocset(input);
    }

    const namespace = this.getNamespace(docset.id);
    await this.vectorStore.init(namespace);
    await this.metadataStore.updateDocset(docset.id, { status: "indexing" });

    const seedUrl = new URL(input.seedSlug, input.baseUrl).toString();
    let seedPage = await this.metadataStore.getPageByUrl(docset.id, seedUrl);
    
    if (!seedPage) {
      seedPage = await this.metadataStore.createPage({
        docsetId: docset.id,
        url: seedUrl,
        path: input.seedSlug,
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
    }

    if (waitForSeed && seedPage.status !== "indexed") {
      await this.indexPage(docset, seedPage);
      docset = (await this.metadataStore.getDocset(docset.id))!;
    }

    this.startBackgroundCrawl(docset.id);

    return docset;
  }

  async indexPage(docset: DocsetRecord, page: PageRecord): Promise<void> {
    const namespace = this.getNamespace(docset.id);

    try {
      await this.metadataStore.updatePage(page.id, { 
        status: "fetching",
        lastAttemptAt: Date.now(),
      });

      const fetchResult = await this.fetcher.fetch(page.url, {
        etag: page.etag ?? undefined,
        lastModified: page.lastModified ?? undefined,
      });

      // HTTP 304 Not Modified - content unchanged, skip re-embedding
      if (fetchResult.statusCode === 304 && fetchResult.fromCache && page.contentHash) {
        console.log(`[incremental] Unchanged (304): ${page.url}`);
        await this.metadataStore.updatePage(page.id, {
          status: "indexed",
          fetchedAt: Date.now(),
        });
        return;
      }

      const contentHash = createHash("sha256").update(fetchResult.content).digest("hex");
      
      // Content hash match - skip re-embedding even if status was reset to pending
      if (page.contentHash === contentHash) {
        console.log(`[incremental] Unchanged (hash): ${page.url}`);
        await this.metadataStore.updatePage(page.id, {
          status: "indexed",
          fetchedAt: Date.now(),
          etag: fetchResult.etag,
          lastModified: fetchResult.lastModified,
        });
        return;
      }

      // Content changed - log for visibility
      if (page.contentHash) {
        console.log(`[incremental] Changed: ${page.url}`);
      } else {
        console.log(`[incremental] New page: ${page.url}`);
      }

      await this.metadataStore.updatePage(page.id, {
        status: "fetched",
        fetchedAt: Date.now(),
        contentHash,
        etag: fetchResult.etag,
        lastModified: fetchResult.lastModified,
      });

      const extracted = await this.extractor.extract(
        fetchResult.content,
        page.url,
        fetchResult.contentType
      );

      await this.metadataStore.updatePage(page.id, {
        title: extracted.title,
        status: "indexing",
      });

      const crawler = this.getCrawler(docset.id);
      await crawler.discoverLinks(docset, page.url, extracted.links, 0);

      // Delete old chunks and vector embeddings before creating new ones
      const existingChunks = await this.metadataStore.getChunks(page.id);
      if (existingChunks.length > 0) {
        const chunkIds = existingChunks.map(c => c.id);
        await this.vectorStore.delete(namespace, chunkIds);
      }
      await this.metadataStore.deleteChunks(page.id);

      const chunks = this.chunker.chunk(extracted);

      if (chunks.length === 0) {
        await this.metadataStore.updatePage(page.id, {
          status: "indexed",
          indexedAt: Date.now(),
        });
        return;
      }

      const chunkRecords = await this.metadataStore.createChunks(
        chunks.map(chunk => ({
          pageId: page.id,
          docsetId: docset.id,
          content: chunk.content,
          heading: chunk.heading,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          chunkIndex: chunk.index,
          embeddingId: null,
        }))
      );

      const embeddingProvider = await this.getEmbeddingProvider();
      const embeddings = await embeddingProvider.embed(
        chunkRecords.map(c => c.content)
      );

      const vectors: EmbeddingVector[] = chunkRecords.map((chunk, i) => ({
        id: chunk.id,
        vector: embeddings[i]!,
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunk.id,
          url: page.url,
          title: extracted.title,
          heading: chunk.heading,
          content: chunk.content,
        },
      }));

      await this.vectorStore.upsert(namespace, vectors);

      for (const chunk of chunkRecords) {
        await this.metadataStore.updateChunk(chunk.id, { embeddingId: chunk.id });
      }

      await this.metadataStore.updatePage(page.id, {
        status: "indexed",
        indexedAt: Date.now(),
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error indexing page ${page.url}:`, errorMessage);
      
      // HTTP 401/403/404 are expected (auth-protected or missing pages) - mark as skipped
      const isSkippable = /^HTTP (401|403|404)\b/.test(errorMessage);
      
      await this.metadataStore.updatePage(page.id, {
        status: isSkippable ? "skipped" : "error",
        errorMessage,
        retryCount: page.retryCount + 1,
      });
    }
  }

  /**
   * Search across indexed documents with enhanced retrieval features
   */
  async search(query: SearchQuery): Promise<EnhancedSearchResult[]> {
    const config = await loadConfig();
    const embeddingProvider = await this.getEmbeddingProvider();
    const queryVector = await embeddingProvider.embedSingle(query.query);
    
    // Apply guardrails with runtime clamping
    const topK = clamp(query.topK ?? 10, 1, 100);
    const minScore = clamp(query.minScore ?? 0.5, 0, 1);
    const vectorTopK = clamp(config.hybrid?.vectorTopK ?? Math.max(topK * 3, 20), 1, 1000);
    const keywordTopK = clamp(config.hybrid?.keywordTopK ?? Math.max(topK * 3, 20), 1, 1000);
    const alpha = clamp(config.hybrid?.alpha ?? 0.65, 0, 1);
    const minKeywordScore = clamp(config.hybrid?.minKeywordScore ?? 0, 0, 1);

    // Retrieval config with overrides
    const maxChunksPerPage = query.maxChunksPerPage ?? config.retrieval.maxChunksPerPage;
    const maxTotalChars = query.maxTotalChars ?? config.retrieval.maxTotalChars;
    const formatSnippets = query.formatSnippets ?? config.retrieval.formatSnippets;
    const snippetMaxChars = config.retrieval.snippetMaxChars;

    const vectorResults = await this.searchVector(
      queryVector,
      query.docsetIds,
      vectorTopK,
      minScore
    );

    let mergedResults: SearchResult[];

    if (!config.hybrid?.enabled) {
      mergedResults = vectorResults.slice(0, topK * 2); // Get extra for diversity filtering
    } else {
      const keywordResults = await this.metadataStore.searchKeyword(
        query.query,
        query.docsetIds,
        keywordTopK
      );

      if (keywordResults.length === 0) {
        mergedResults = vectorResults.slice(0, topK * 2);
      } else {
        mergedResults = this.mergeHybridResults(
          vectorResults,
          keywordResults,
          alpha,
          minKeywordScore,
          topK * 2 // Get extra for diversity filtering
        );
      }
    }

    // Apply diversity filtering (limit chunks per page)
    const diverseResults = this.applyDiversityFilter(mergedResults, maxChunksPerPage, topK);

    // Format snippets and apply character budget
    return this.formatAndBudgetResults(diverseResults, formatSnippets, snippetMaxChars, maxTotalChars);
  }

  /**
   * Apply diversity filter to limit chunks from the same page
   */
  private applyDiversityFilter(
    results: SearchResult[],
    maxChunksPerPage: number,
    topK: number
  ): SearchResult[] {
    const pageChunkCounts = new Map<string, number>();
    const diverseResults: SearchResult[] = [];

    for (const result of results) {
      const pageKey = `${result.docsetId}:${result.pageId}`;
      const currentCount = pageChunkCounts.get(pageKey) ?? 0;

      if (currentCount < maxChunksPerPage) {
        diverseResults.push(result);
        pageChunkCounts.set(pageKey, currentCount + 1);

        if (diverseResults.length >= topK) {
          break;
        }
      }
    }

    return diverseResults;
  }

  /**
   * Format snippets and apply character budget
   */
  private formatAndBudgetResults(
    results: SearchResult[],
    formatSnippets: boolean,
    snippetMaxChars: number,
    maxTotalChars: number
  ): EnhancedSearchResult[] {
    const enhancedResults: EnhancedSearchResult[] = [];
    let totalChars = 0;

    for (const result of results) {
      const snippet = formatSnippets
        ? this.createFormattedSnippet(result, snippetMaxChars)
        : undefined;

      const charCount = snippet?.charCount ?? result.content.length;

      // Check if adding this result would exceed budget
      if (totalChars + charCount > maxTotalChars && enhancedResults.length > 0) {
        // Try to truncate the content to fit within remaining budget
        const remainingBudget = maxTotalChars - totalChars;
        if (remainingBudget >= 200) { // Only include if we can fit meaningful content
          const truncatedSnippet = formatSnippets
            ? this.createFormattedSnippet(result, remainingBudget)
            : undefined;
          enhancedResults.push({ ...result, snippet: truncatedSnippet });
        }
        break;
      }

      totalChars += charCount;
      enhancedResults.push({ ...result, snippet });
    }

    return enhancedResults;
  }

  /**
   * Create a formatted snippet with title, URL, and breadcrumb
   */
  private createFormattedSnippet(result: SearchResult, maxChars: number): FormattedSnippet {
    const title = result.title ?? "Untitled";
    const url = result.url;
    const breadcrumb = result.heading ? this.formatBreadcrumb(result.heading, url) : null;

    // Calculate overhead for formatting
    const headerLines = [
      `## ${title}`,
      `Source: ${url}`,
      breadcrumb ? `Section: ${breadcrumb}` : null,
      "",
    ].filter(Boolean);
    const header = headerLines.join("\n");
    const headerChars = header.length;

    // Calculate remaining chars for content
    const contentBudget = Math.max(100, maxChars - headerChars - 10); // Reserve some for ellipsis
    const truncatedContent = this.truncateContent(result.content, contentBudget);

    const formatted = `${header}${truncatedContent}`;

    return {
      formatted,
      title: result.title,
      url,
      breadcrumb,
      content: truncatedContent,
      charCount: formatted.length,
    };
  }

  /**
   * Format heading into a breadcrumb path
   */
  private formatBreadcrumb(heading: string, url: string): string {
    // Extract path segments from URL for context
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname
        .split("/")
        .filter(p => p && p !== "docs" && p !== "api");

      // If we have path context and it differs from heading, include it
      if (pathParts.length > 0) {
        const pathContext = pathParts
          .map(p => p.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()))
          .slice(-2) // Last 2 path segments
          .join(" > ");

        // Don't repeat if heading already contains path context
        if (!heading.toLowerCase().includes(pathParts[pathParts.length - 1]?.toLowerCase() ?? "")) {
          return `${pathContext} > ${heading}`;
        }
      }
    } catch {
      // Invalid URL, just return heading
    }
    return heading;
  }

  /**
   * Truncate content intelligently at sentence/paragraph boundaries
   */
  private truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content;
    }

    // Try to truncate at paragraph boundary
    const paragraphEnd = content.lastIndexOf("\n\n", maxChars);
    if (paragraphEnd > maxChars * 0.5) {
      return content.slice(0, paragraphEnd) + "\n...";
    }

    // Try to truncate at sentence boundary
    const sentenceEnders = [". ", "! ", "? "];
    let lastSentenceEnd = -1;
    for (const ender of sentenceEnders) {
      const pos = content.lastIndexOf(ender, maxChars);
      if (pos > lastSentenceEnd) {
        lastSentenceEnd = pos + 1;
      }
    }

    if (lastSentenceEnd > maxChars * 0.5) {
      return content.slice(0, lastSentenceEnd) + "...";
    }

    // Fall back to word boundary
    const lastSpace = content.lastIndexOf(" ", maxChars);
    if (lastSpace > maxChars * 0.7) {
      return content.slice(0, lastSpace) + "...";
    }

    // Hard truncate as last resort
    return content.slice(0, maxChars - 3) + "...";
  }

  private async searchVector(
    queryVector: number[],
    docsetIds: string[] | undefined,
    topK: number,
    minScore: number
  ): Promise<SearchResult[]> {
    if (docsetIds && docsetIds.length > 0) {
      const results: SearchResult[] = [];
      for (const docsetId of docsetIds) {
        const namespace = this.getNamespace(docsetId);
        const docsetResults = await this.vectorStore.search(
          namespace,
          queryVector,
          topK,
          minScore
        );
        results.push(...docsetResults);
      }
      return results.sort((a, b) => b.score - a.score).slice(0, topK);
    }

    const docsets = await this.metadataStore.listDocsets();
    const results: SearchResult[] = [];

    for (const docset of docsets) {
      const namespace = this.getNamespace(docset.id);
      const docsetResults = await this.vectorStore.search(
        namespace,
        queryVector,
        topK,
        minScore
      );
      results.push(...docsetResults);
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private mergeHybridResults(
    vectorResults: SearchResult[],
    keywordResults: KeywordSearchResult[],
    alpha: number,
    minKeywordScore: number,
    topK: number
  ): SearchResult[] {
    const resultsMap = new Map<
      string,
      { result: SearchResult; vectorScore: number; keywordScore: number }
    >();

    for (const result of vectorResults) {
      resultsMap.set(result.chunkId, {
        result,
        vectorScore: result.score,
        keywordScore: 0,
      });
    }

    for (const keywordResult of keywordResults) {
      if (keywordResult.keywordScore < minKeywordScore) continue;
      const existing = resultsMap.get(keywordResult.chunkId);
      if (existing) {
        existing.keywordScore = Math.max(existing.keywordScore, keywordResult.keywordScore);
      } else {
        resultsMap.set(keywordResult.chunkId, {
          result: {
            chunkId: keywordResult.chunkId,
            pageId: keywordResult.pageId,
            docsetId: keywordResult.docsetId,
            url: keywordResult.url,
            title: keywordResult.title,
            heading: keywordResult.heading,
            content: keywordResult.content,
            score: keywordResult.keywordScore,
          },
          vectorScore: 0,
          keywordScore: keywordResult.keywordScore,
        });
      }
    }

    const merged = Array.from(resultsMap.values()).map(({ result, vectorScore, keywordScore }) => {
      const safeKeywordScore = Math.max(0, Math.min(1, keywordScore));
      const safeVectorScore = Math.max(0, Math.min(1, vectorScore));
      const hybridScore = alpha * safeVectorScore + (1 - alpha) * safeKeywordScore;
      return { ...result, score: hybridScore };
    });

    return merged.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private getRunnerState(docsetId: string): CrawlRunnerState {
    let state = this.runnerStates.get(docsetId);
    if (!state) {
      state = {
        inFlight: 0,
        nextAllowedFetchAt: 0,
        stopRequested: false,
        runningPromise: null,
      };
      this.runnerStates.set(docsetId, state);
    }
    return state;
  }

  private async waitForFetchSlot(state: CrawlRunnerState, requestDelay: number): Promise<void> {
    const now = Date.now();
    if (now < state.nextAllowedFetchAt) {
      await new Promise(resolve => setTimeout(resolve, state.nextAllowedFetchAt - now));
    }
    state.nextAllowedFetchAt = Date.now() + requestDelay;
  }

  private startBackgroundCrawl(docsetId: string): void {
    const state = this.getRunnerState(docsetId);
    
    if (state.runningPromise) {
      return;
    }

    state.stopRequested = false;
    state.runningPromise = this.runConcurrentCrawl(docsetId, state);
    
    state.runningPromise
      .catch(err => console.error(`Background crawl error for ${docsetId}:`, err))
      .finally(() => {
        state.runningPromise = null;
      });
  }

  private async runConcurrentCrawl(docsetId: string, state: CrawlRunnerState): Promise<void> {
    const config = await loadConfig();
    const concurrency = config.crawler.concurrency;
    const requestDelay = config.crawler.requestDelay;

    const docset = await this.metadataStore.getDocset(docsetId);
    if (!docset) {
      return;
    }

    const crawler = this.getCrawler(docsetId);
    if (!crawler.hasMore()) {
      await crawler.loadPendingPages(docsetId);
    }

    const workers: Promise<void>[] = [];

    const spawnWorker = async (): Promise<void> => {
      while (!state.stopRequested) {
        if (state.inFlight >= concurrency) {
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        const page = await this.metadataStore.getNextPendingPage(docsetId);
        if (!page) {
          break;
        }

        state.inFlight++;

        const currentDocset = await this.metadataStore.getDocset(docsetId);
        if (!currentDocset) {
          state.inFlight--;
          break;
        }

        await this.waitForFetchSlot(state, requestDelay);

        this.indexPage(currentDocset, page)
          .catch(err => console.error(`Error indexing ${page.url}:`, err))
          .finally(() => {
            state.inFlight--;
          });

        if (!crawler.hasMore()) {
          await crawler.loadPendingPages(docsetId);
        }
      }
    };

    for (let i = 0; i < concurrency; i++) {
      workers.push(spawnWorker());
    }

    await Promise.all(workers);

    while (state.inFlight > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!state.stopRequested) {
      await this.metadataStore.updateDocset(docsetId, { status: "ready" });
    }
  }

  /**
   * Resume background crawling for a docset (called on worker restart)
   */
  resumeBackgroundCrawl(docsetId: string): void {
    this.startBackgroundCrawl(docsetId);
  }

  /**
   * Stop background crawling for a docset
   */
  stopBackgroundCrawl(docsetId: string): void {
    const state = this.runnerStates.get(docsetId);
    if (state) {
      state.stopRequested = true;
    }
  }

  /**
   * Stop all background crawling
   */
  stopAllBackgroundCrawls(): void {
    for (const [docsetId] of this.runnerStates) {
      this.stopBackgroundCrawl(docsetId);
    }
  }

  /**
   * Check if a docset is currently being crawled
   */
  isCrawling(docsetId: string): boolean {
    const state = this.runnerStates.get(docsetId);
    if (!state) return false;
    return state.runningPromise !== null && !state.stopRequested;
  }

  /**
   * Wait for background crawl to complete (useful for testing)
   */
  async waitForCrawlComplete(docsetId: string): Promise<void> {
    const state = this.runnerStates.get(docsetId);
    if (state?.runningPromise) {
      await state.runningPromise;
    }
  }

  private getCrawler(docsetId: string): LinkCrawler {
    let crawler = this.crawlers.get(docsetId);
    if (!crawler) {
      crawler = createLinkCrawler(this.crawlerOptions);
      this.crawlers.set(docsetId, crawler);
    }
    return crawler;
  }

  private getNamespace(docsetId: string): string {
    return `docset-${docsetId}`;
  }

  /**
   * Get index status for a docset
   */
  async getIndexStatus(docsetId: string) {
    return this.metadataStore.getIndexStatus(docsetId);
  }

  /**
   * List all docsets
   */
  async listDocsets() {
    return this.metadataStore.listDocsets();
  }

  /**
   * Delete a docset and all its data
   */
  async deleteDocset(docsetId: string): Promise<void> {
    this.stopBackgroundCrawl(docsetId);
    const namespace = this.getNamespace(docsetId);
    await this.vectorStore.clear(namespace);
    this.crawlers.delete(docsetId);
    await this.metadataStore.deleteDocset(docsetId);
  }

  /**
   * Get stuck pages for a docset (pages in intermediate states for too long).
   */
  async getStuckPages(docsetId: string, stuckThresholdMs = 5 * 60 * 1000): Promise<StuckPageInfo[]> {
    return this.metadataStore.getStuckPages(docsetId, stuckThresholdMs);
  }

  /**
   * Recover from a crash by resetting stuck pages and resuming crawls.
   * Should be called on worker startup.
   * Returns stats about what was recovered.
   */
  async recoverFromCrash(options?: { 
    stuckThresholdMs?: number;
    maxRetries?: number;
  }): Promise<{
    docsetsRecovered: number;
    stuckPagesReset: number;
    errorPagesRetried: number;
  }> {
    const stuckThresholdMs = options?.stuckThresholdMs ?? 5 * 60 * 1000;
    const maxRetries = options?.maxRetries ?? 3;

    const docsets = await this.metadataStore.listDocsets();
    let totalStuckReset = 0;
    let totalErrorRetried = 0;
    let docsetsRecovered = 0;

    for (const docset of docsets) {
      // Skip docsets that are already fully ready
      if (docset.status === "ready") {
        const status = await this.metadataStore.getIndexStatus(docset.id);
        if (status.pendingPages === 0 && status.stuckPages === 0) {
          continue;
        }
      }

      // Reset stuck pages (in intermediate states too long)
      const stuckReset = await this.metadataStore.resetStuckPages(docset.id, stuckThresholdMs);
      if (stuckReset > 0) {
        console.log(`[recovery] Reset ${stuckReset} stuck pages for docset ${docset.name}`);
        totalStuckReset += stuckReset;
      }

      // Reset error pages that haven't exhausted retries
      const errorRetried = await this.metadataStore.resetErrorPagesForRetry(docset.id, maxRetries);
      if (errorRetried > 0) {
        console.log(`[recovery] Queued ${errorRetried} error pages for retry in docset ${docset.name}`);
        totalErrorRetried += errorRetried;
      }

      // Check if there are pending pages to process
      const status = await this.metadataStore.getIndexStatus(docset.id);
      if (status.pendingPages > 0) {
        // Update docset status to indexing if it was ready
        if (docset.status === "ready") {
          await this.metadataStore.updateDocset(docset.id, { status: "indexing" });
        }
        
        // Resume crawling
        console.log(`[recovery] Resuming crawl for docset ${docset.name} (${status.pendingPages} pending)`);
        this.startBackgroundCrawl(docset.id);
        docsetsRecovered++;
      }
    }

    return {
      docsetsRecovered,
      stuckPagesReset: totalStuckReset,
      errorPagesRetried: totalErrorRetried,
    };
  }
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

let orchestrator: IndexerOrchestrator | null = null;

export function getOrchestrator(): IndexerOrchestrator {
  if (!orchestrator) {
    orchestrator = new IndexerOrchestrator();
  }
  return orchestrator;
}
