import { describe, test, expect } from "bun:test";
import { DocExtractor } from "../src/crawler/extractor";

describe("DocExtractor", () => {
  const extractor = new DocExtractor();

  test("should extract title from HTML", async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body><h1>Main Heading</h1><p>Content here</p></body>
      </html>
    `;

    const result = await extractor.extract(html, "https://example.com/page", "text/html");
    
    expect(result.title).toBe("Test Page");
    expect(result.url).toBe("https://example.com/page");
  });

  test("should extract links from HTML", async () => {
    const html = `
      <html>
        <body>
          <a href="/docs/page1">Page 1</a>
          <a href="/docs/page2">Page 2</a>
          <a href="https://other.com/external">External</a>
        </body>
      </html>
    `;

    const result = await extractor.extract(html, "https://example.com/", "text/html");
    
    expect(result.links).toContain("https://example.com/docs/page1");
    expect(result.links).toContain("https://example.com/docs/page2");
    expect(result.links).not.toContain("https://other.com/external");
  });

  test("should extract content from markdown", async () => {
    const md = `# Getting Started

This is the introduction.

## Installation

Run npm install.

## Usage

Import and use.`;

    const result = await extractor.extract(md, "https://example.com/docs.md", "text/markdown");
    
    expect(result.title).toBe("Getting Started");
    expect(result.headings.length).toBeGreaterThan(0);
    expect(result.content).toContain("This is the introduction");
  });

  test("should extract headings from markdown", async () => {
    const md = `# Title
## Section 1
### Subsection 1.1
## Section 2`;

    const result = await extractor.extract(md, "https://example.com/doc.md", "text/markdown");
    
    expect(result.headings).toHaveLength(4);
    expect(result.headings[0].level).toBe(1);
    expect(result.headings[0].text).toBe("Title");
    expect(result.headings[1].level).toBe(2);
    expect(result.headings[1].text).toBe("Section 1");
  });

  test("should handle minimal HTML content", async () => {
    const html = "<html><body></body></html>";
    const result = await extractor.extract(html, "https://example.com/empty", "text/html");
    
    expect(result.title).toBe("Untitled");
    expect(result.url).toBe("https://example.com/empty");
  });
});
