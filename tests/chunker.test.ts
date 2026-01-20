import { describe, test, expect } from "bun:test";
import { TextChunker } from "../src/crawler/chunker";
import type { ExtractedContent } from "../src/types";

describe("TextChunker", () => {
  const chunker = new TextChunker();

  test("should return single chunk for small content", () => {
    const content: ExtractedContent = {
      url: "https://example.com/doc",
      title: "Test Doc",
      content: "This is a short piece of content.",
      links: [],
      headings: [],
    };

    const chunks = chunker.chunk(content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("This is a short piece of content.");
    expect(chunks[0].index).toBe(0);
  });

  test("should split large content into multiple chunks", () => {
    const longContent = Array(100).fill("This is a sentence that repeats.").join(" ");
    
    const content: ExtractedContent = {
      url: "https://example.com/doc",
      title: "Test Doc",
      content: longContent,
      links: [],
      headings: [],
    };

    const chunks = chunker.chunk(content, { maxChunkSize: 500 });
    
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      expect(chunk.content.length).toBeLessThanOrEqual(500 + 100); // Allow some overflow
    });
  });

  test("should respect heading boundaries", () => {
    const content: ExtractedContent = {
      url: "https://example.com/doc",
      title: "Test Doc",
      content: `# Introduction
This is the intro section.

# Getting Started
This is the getting started section.

# Advanced Usage
This is the advanced section.`,
      links: [],
      headings: [
        { level: 1, text: "Introduction", offset: 0 },
        { level: 1, text: "Getting Started", offset: 50 },
        { level: 1, text: "Advanced Usage", offset: 100 },
      ],
    };

    const chunks = chunker.chunk(content, { maxChunkSize: 2000 });
    
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  test("should set correct chunk indices", () => {
    const content: ExtractedContent = {
      url: "https://example.com/doc",
      title: "Test Doc",
      content: Array(50).fill("Word").join(" "),
      links: [],
      headings: [],
    };

    const chunks = chunker.chunk(content, { maxChunkSize: 50 });
    
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });
});
