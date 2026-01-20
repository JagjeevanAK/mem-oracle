// HTTP fetcher with caching and conditional requests (ETag/Last-Modified)

import type { Fetcher, FetchResult, FetchOptions } from "../types";
import { getContentCache, ContentCache } from "../storage/content-cache";

export class HttpFetcher implements Fetcher {
  private cache: ContentCache;
  private userAgent: string;
  private timeout: number;
  private tryMarkdownFirst: boolean;

  constructor(options?: { cache?: ContentCache; userAgent?: string; timeout?: number; tryMarkdownFirst?: boolean }) {
    this.cache = options?.cache ?? getContentCache();
    this.userAgent = options?.userAgent ?? "mem-oracle/1.0 (docs indexer)";
    this.timeout = options?.timeout ?? 30000;
    this.tryMarkdownFirst = options?.tryMarkdownFirst ?? true;
  }

  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    // Try .md format first for doc sites (many now support it)
    if (this.tryMarkdownFirst && this.shouldTryMarkdown(url)) {
      const mdUrl = this.toMarkdownUrl(url);
      if (mdUrl !== url) {
        try {
          const mdResult = await this.fetchUrl(mdUrl, options);
          if (mdResult.statusCode === 200 && mdResult.content.length > 100) {
            // Return with original URL but markdown content
            return { ...mdResult, url };
          }
        } catch {
          // .md not available, fall through to regular fetch
        }
      }
    }

    return this.fetchUrl(url, options);
  }

  private shouldTryMarkdown(url: string): boolean {
    // Skip if already markdown or has file extension
    if (url.endsWith(".md") || url.endsWith(".mdx")) return false;
    if (/\.\w{2,4}$/.test(url)) return false;
    
    // Try for /docs paths which commonly support .md
    const urlObj = new URL(url);
    return urlObj.pathname.includes("/docs") || 
           urlObj.pathname.includes("/documentation") ||
           urlObj.pathname.includes("/guide");
  }

  private toMarkdownUrl(url: string): string {
    const urlObj = new URL(url);
    // Remove trailing slash and add .md
    let path = urlObj.pathname.replace(/\/$/, "");
    if (!path.endsWith(".md")) {
      path += ".md";
    }
    urlObj.pathname = path;
    return urlObj.toString();
  }

  private async fetchUrl(url: string, options?: FetchOptions): Promise<FetchResult> {
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
      // Detect markdown content even if server doesn't set correct content-type
      const serverContentType = response.headers.get("Content-Type") ?? "text/html";
      const contentType = this.detectContentType(url, content, serverContentType);
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

  private detectContentType(url: string, content: string, serverType: string): string {
    // If URL ends with .md, it's markdown
    if (url.endsWith(".md") || url.endsWith(".mdx")) {
      return "text/markdown";
    }
    
    // Check if content looks like markdown (starts with # heading or has common md patterns)
    const trimmed = content.trim();
    if (trimmed.startsWith("# ") || 
        trimmed.startsWith("## ") ||
        /^---\n[\s\S]*?\n---/.test(trimmed) || // frontmatter
        /^\* \*\*[^*]+\*\*/.test(trimmed)) { // bold list items
      return "text/markdown";
    }
    
    return serverType;
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
