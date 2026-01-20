// HTTP fetcher with caching and conditional requests (ETag/Last-Modified)

import type { Fetcher, FetchResult, FetchOptions } from "../types";
import { getContentCache, ContentCache } from "../storage/content-cache";

export class HttpFetcher implements Fetcher {
  private cache: ContentCache;
  private userAgent: string;
  private timeout: number;

  constructor(options?: { cache?: ContentCache; userAgent?: string; timeout?: number }) {
    this.cache = options?.cache ?? getContentCache();
    this.userAgent = options?.userAgent ?? "mem-oracle/1.0 (docs indexer)";
    this.timeout = options?.timeout ?? 30000;
  }

  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    const cached = await this.cache.get(url);
    
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      "Accept": "text/html,text/markdown,text/plain,application/xhtml+xml,*/*",
    };

    if (options?.etag) {
      headers["If-None-Match"] = options.etag;
    } else if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }

    if (options?.lastModified) {
      headers["If-Modified-Since"] = options.lastModified;
    } else if (cached?.lastModified) {
      headers["If-Modified-Since"] = cached.lastModified;
    }

    const timeout = options?.timeout ?? this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (response.status === 304 && cached) {
        return {
          url,
          content: cached.content,
          contentType: cached.contentType,
          etag: cached.etag,
          lastModified: cached.lastModified,
          statusCode: 304,
          fromCache: true,
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      const contentType = response.headers.get("Content-Type") ?? "text/html";
      const etag = response.headers.get("ETag");
      const lastModified = response.headers.get("Last-Modified");

      await this.cache.set(url, {
        content,
        contentType,
        fetchedAt: Date.now(),
        etag,
        lastModified,
      });

      return {
        url,
        content,
        contentType,
        etag,
        lastModified,
        statusCode: response.status,
        fromCache: false,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (cached) {
        return {
          url,
          content: cached.content,
          contentType: cached.contentType,
          etag: cached.etag,
          lastModified: cached.lastModified,
          statusCode: 0,
          fromCache: true,
        };
      }

      throw error;
    }
  }

  async fetchRaw(url: string, timeout?: number): Promise<{ content: string; contentType: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout ?? this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent,
          "Accept": "text/html,text/markdown,text/plain,application/xhtml+xml,*/*",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        content: await response.text(),
        contentType: response.headers.get("Content-Type") ?? "text/html",
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

let httpFetcher: HttpFetcher | null = null;

export function getHttpFetcher(): HttpFetcher {
  if (!httpFetcher) {
    httpFetcher = new HttpFetcher();
  }
  return httpFetcher;
}
