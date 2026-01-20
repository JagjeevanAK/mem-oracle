// Content cache for storing fetched HTML/MD on disk

import { join } from "path";
import { createHash } from "crypto";
import { getDataDir } from "../config";

interface CachedContent {
  url: string;
  content: string;
  contentType: string;
  fetchedAt: number;
  etag: string | null;
  lastModified: string | null;
}

export class ContentCache {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? join(getDataDir(), "cache");
  }

  async get(url: string): Promise<CachedContent | null> {
    const filePath = this.getCachePath(url);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return null;
    }

    try {
      return await file.json();
    } catch {
      return null;
    }
  }

  async set(url: string, data: Omit<CachedContent, "url">): Promise<void> {
    const filePath = this.getCachePath(url);
    const cached: CachedContent = { url, ...data };
    await Bun.write(filePath, JSON.stringify(cached));
  }

  async has(url: string): Promise<boolean> {
    const filePath = this.getCachePath(url);
    const file = Bun.file(filePath);
    return file.exists();
  }

  async delete(url: string): Promise<void> {
    const filePath = this.getCachePath(url);
    try {
      await Bun.$`rm -f ${filePath}`.quiet();
    } catch {
      // File might not exist
    }
  }

  async clear(): Promise<void> {
    try {
      await Bun.$`rm -rf ${this.cacheDir}/*`.quiet();
    } catch {
      // Directory might not exist
    }
  }

  private getCachePath(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
    
    let domain = "unknown";
    try {
      domain = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
    } catch {
      // Invalid URL
    }

    const domainDir = join(this.cacheDir, domain);
    return join(domainDir, `${hash}.json`);
  }

  async getStats(): Promise<{ fileCount: number; totalSize: number }> {
    let fileCount = 0;
    let totalSize = 0;

    try {
      const result = await Bun.$`find ${this.cacheDir} -name "*.json" -type f`.quiet();
      const files = result.text().trim().split("\n").filter(Boolean);
      fileCount = files.length;

      for (const file of files) {
        const bunFile = Bun.file(file);
        totalSize += bunFile.size;
      }
    } catch {
      // Directory might not exist
    }

    return { fileCount, totalSize };
  }
}

let contentCache: ContentCache | null = null;

export function getContentCache(): ContentCache {
  if (!contentCache) {
    contentCache = new ContentCache();
  }
  return contentCache;
}
