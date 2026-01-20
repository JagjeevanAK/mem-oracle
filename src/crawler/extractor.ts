// Doc extractor using Readability for HTML and custom parsing for Markdown

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { Extractor, ExtractedContent, HeadingInfo } from "../types";

export class DocExtractor implements Extractor {
  async extract(content: string, url: string, contentType: string): Promise<ExtractedContent> {
    const isMarkdown = contentType.includes("markdown") || 
                       contentType.includes("text/md") ||
                       url.endsWith(".md") ||
                       url.endsWith(".mdx");

    if (isMarkdown) {
      return this.extractMarkdown(content, url);
    }

    return this.extractHtml(content, url);
  }

  private extractHtml(html: string, url: string): ExtractedContent {
    const { document } = parseHTML(html);
    
    const title = document.querySelector("title")?.textContent?.trim() ||
                  document.querySelector("h1")?.textContent?.trim() ||
                  "Untitled";

    const links = this.extractLinks(document, url);

    // linkedom provides DOM-compatible document that Readability can process
    const reader = new Readability(document as unknown as Document, {
      charThreshold: 0,
    });
    
    const article = reader.parse();
    
    if (!article) {
      const body = document.body?.textContent || "";
      return {
        url,
        title,
        content: this.cleanText(body),
        links,
        headings: [],
      };
    }

    const textContent = this.htmlToText(article.content ?? "");
    const headings = this.extractHeadings(article.content ?? "");

    return {
      url,
      title: article.title || title,
      content: textContent,
      links,
      headings,
    };
  }

  private extractMarkdown(md: string, url: string): ExtractedContent {
    const titleMatch = md.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || "Untitled";
    const links = this.extractMarkdownLinks(md, url);
    const headings = this.extractMarkdownHeadings(md);
    const content = this.cleanMarkdown(md);

    return { url, title, content, links, headings };
  }

  private extractLinks(document: ReturnType<typeof parseHTML>["document"], baseUrl: string): string[] {
    const links: string[] = [];
    const baseUrlObj = new URL(baseUrl);
    
    const anchors = document.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) continue;

      try {
        const absoluteUrl = new URL(href, baseUrl);
        
        if (absoluteUrl.hostname === baseUrlObj.hostname) {
          absoluteUrl.hash = "";
          const cleanUrl = absoluteUrl.toString();
          
          if (!links.includes(cleanUrl)) {
            links.push(cleanUrl);
          }
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return links;
  }

  private extractMarkdownLinks(md: string, baseUrl: string): string[] {
    const links: string[] = [];
    const baseUrlObj = new URL(baseUrl);
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(md)) !== null) {
      const href = match[2];
      if (!href) continue;

      try {
        const absoluteUrl = new URL(href, baseUrl);
        
        if (absoluteUrl.hostname === baseUrlObj.hostname) {
          absoluteUrl.hash = "";
          const cleanUrl = absoluteUrl.toString();
          
          if (!links.includes(cleanUrl)) {
            links.push(cleanUrl);
          }
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return links;
  }

  private extractHeadings(html: string): HeadingInfo[] {
    const headings: HeadingInfo[] = [];
    const { document } = parseHTML(`<div>${html}</div>`);
    
    const headingElements = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    let offset = 0;

    for (const heading of headingElements) {
      const level = parseInt(heading.tagName.slice(1));
      const text = heading.textContent?.trim() || "";
      
      if (text) {
        headings.push({ level, text, offset });
        offset += text.length;
      }
    }

    return headings;
  }

  private extractMarkdownHeadings(md: string): HeadingInfo[] {
    const headings: HeadingInfo[] = [];
    const lines = md.split("\n");
    let offset = 0;

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match && match[1] && match[2]) {
        const level = match[1].length;
        const text = match[2].trim();
        headings.push({ level, text, offset });
      }
      offset += line.length + 1;
    }

    return headings;
  }

  private htmlToText(html: string): string {
    const { document } = parseHTML(`<div>${html}</div>`);
    
    const scripts = document.querySelectorAll("script, style, noscript");
    for (const script of scripts) {
      script.remove();
    }

    let text = "";
    const blockElements = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "hr", "tr"];
    
    function processNode(node: unknown) {
      const n = node as { nodeType: number; textContent?: string; tagName?: string; childNodes?: unknown[] };
      if (n.nodeType === 3) {
        text += n.textContent ?? "";
      } else if (n.nodeType === 1) {
        const tagName = n.tagName?.toLowerCase() ?? "";
        
        if (blockElements.includes(tagName)) {
          text += "\n";
        }
        
        for (const child of Array.from(n.childNodes ?? [])) {
          processNode(child);
        }
        
        if (blockElements.includes(tagName)) {
          text += "\n";
        }
      }
    }

    processNode(document.body || document);
    
    return this.cleanText(text);
  }

  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      .replace(/ +/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map(line => line.trim())
      .join("\n")
      .trim();
  }

  private cleanMarkdown(md: string): string {
    return md
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^---[\s\S]*?---\n?/m, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

let docExtractor: DocExtractor | null = null;

export function getDocExtractor(): DocExtractor {
  if (!docExtractor) {
    docExtractor = new DocExtractor();
  }
  return docExtractor;
}
