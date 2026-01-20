// Text chunker - splits content into semantic chunks based on headings and size limits

import type { Chunker, ExtractedContent, Chunk, ChunkOptions } from "../types";

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxChunkSize: 1500,
  minChunkSize: 100,
  overlap: 100,
};

export class TextChunker implements Chunker {
  chunk(content: ExtractedContent, options?: ChunkOptions): Chunk[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { maxChunkSize, minChunkSize, overlap } = opts;

    const text = content.content;
    const headings = content.headings;

    if (text.length <= maxChunkSize) {
      return [{
        content: text,
        heading: headings[0]?.text ?? null,
        startOffset: 0,
        endOffset: text.length,
        index: 0,
      }];
    }

    const chunks: Chunk[] = [];
    const sections = this.splitByHeadings(text, headings);
    
    let chunkIndex = 0;
    for (const section of sections) {
      if (section.content.length <= maxChunkSize) {
        chunks.push({
          content: section.content,
          heading: section.heading,
          startOffset: section.startOffset,
          endOffset: section.startOffset + section.content.length,
          index: chunkIndex++,
        });
      } else {
        const subChunks = this.splitLargeSection(
          section.content,
          section.heading,
          section.startOffset,
          maxChunkSize,
          minChunkSize,
          overlap,
          chunkIndex
        );
        chunks.push(...subChunks);
        chunkIndex += subChunks.length;
      }
    }

    return this.mergeSmallChunks(chunks, minChunkSize, maxChunkSize);
  }

  private splitByHeadings(text: string, headings: { level: number; text: string; offset: number }[]): { content: string; heading: string | null; startOffset: number }[] {
    if (headings.length === 0) {
      return [{ content: text, heading: null, startOffset: 0 }];
    }

    const sections: { content: string; heading: string | null; startOffset: number }[] = [];
    const headingPositions: { heading: string; position: number }[] = [];
    
    for (const h of headings) {
      const searchText = h.text;
      const patterns = [
        new RegExp(`^#{1,6}\\s*${escapeRegex(searchText)}\\s*$`, "m"),
        new RegExp(`^${escapeRegex(searchText)}\\s*$`, "m"),
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.index !== undefined) {
          headingPositions.push({ heading: searchText, position: match.index });
          break;
        }
      }
    }

    headingPositions.sort((a, b) => a.position - b.position);

    let lastPos = 0;
    let lastHeading: string | null = null;

    for (const { heading, position } of headingPositions) {
      if (position > lastPos) {
        const content = text.slice(lastPos, position).trim();
        if (content) {
          sections.push({
            content,
            heading: lastHeading,
            startOffset: lastPos,
          });
        }
      }
      lastPos = position;
      lastHeading = heading;
    }

    if (lastPos < text.length) {
      const content = text.slice(lastPos).trim();
      if (content) {
        sections.push({
          content,
          heading: lastHeading,
          startOffset: lastPos,
        });
      }
    }

    return sections.length > 0 ? sections : [{ content: text, heading: null, startOffset: 0 }];
  }

  private splitLargeSection(
    text: string,
    heading: string | null,
    baseOffset: number,
    maxSize: number,
    minSize: number,
    overlap: number,
    startIndex: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const paragraphs = text.split(/\n\n+/);
    
    let currentChunk = "";
    let currentOffset = baseOffset;
    let chunkIndex = startIndex;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      if (currentChunk.length + trimmedPara.length + 2 <= maxSize) {
        currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
      } else {
        if (currentChunk.length >= minSize) {
          chunks.push({
            content: currentChunk,
            heading,
            startOffset: currentOffset,
            endOffset: currentOffset + currentChunk.length,
            index: chunkIndex++,
          });
          
          if (overlap > 0) {
            const overlapStart = Math.max(0, currentChunk.length - overlap);
            const overlapText = currentChunk.slice(overlapStart);
            currentChunk = overlapText + "\n\n" + trimmedPara;
          } else {
            currentChunk = trimmedPara;
          }
          currentOffset += currentChunk.length;
        } else {
          currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
        }

        if (currentChunk.length > maxSize) {
          const sentenceChunks = this.splitBySentences(
            currentChunk,
            heading,
            currentOffset,
            maxSize,
            chunkIndex
          );
          chunks.push(...sentenceChunks);
          chunkIndex += sentenceChunks.length;
          currentChunk = "";
          currentOffset += currentChunk.length;
        }
      }
    }

    if (currentChunk.length >= minSize) {
      chunks.push({
        content: currentChunk,
        heading,
        startOffset: currentOffset,
        endOffset: currentOffset + currentChunk.length,
        index: chunkIndex,
      });
    } else if (currentChunk && chunks.length > 0) {
      const lastChunk = chunks[chunks.length - 1]!;
      if (lastChunk.content.length + currentChunk.length <= maxSize) {
        lastChunk.content += "\n\n" + currentChunk;
        lastChunk.endOffset = lastChunk.startOffset + lastChunk.content.length;
      } else {
        chunks.push({
          content: currentChunk,
          heading,
          startOffset: currentOffset,
          endOffset: currentOffset + currentChunk.length,
          index: chunkIndex,
        });
      }
    }

    return chunks;
  }

  private splitBySentences(
    text: string,
    heading: string | null,
    baseOffset: number,
    maxSize: number,
    startIndex: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    let currentChunk = "";
    let currentOffset = baseOffset;
    let chunkIndex = startIndex;

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length + 1 <= maxSize) {
        currentChunk += (currentChunk ? " " : "") + sentence;
      } else {
        if (currentChunk) {
          chunks.push({
            content: currentChunk,
            heading,
            startOffset: currentOffset,
            endOffset: currentOffset + currentChunk.length,
            index: chunkIndex++,
          });
          currentOffset += currentChunk.length + 1;
        }
        
        if (sentence.length > maxSize) {
          const wordChunks = this.splitByWords(sentence, heading, currentOffset, maxSize, chunkIndex);
          chunks.push(...wordChunks);
          chunkIndex += wordChunks.length;
          currentChunk = "";
        } else {
          currentChunk = sentence;
        }
      }
    }

    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        heading,
        startOffset: currentOffset,
        endOffset: currentOffset + currentChunk.length,
        index: chunkIndex,
      });
    }

    return chunks;
  }

  private splitByWords(
    text: string,
    heading: string | null,
    baseOffset: number,
    maxSize: number,
    startIndex: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const words = text.split(/\s+/);
    
    let currentChunk = "";
    let currentOffset = baseOffset;
    let chunkIndex = startIndex;

    for (const word of words) {
      if (currentChunk.length + word.length + 1 <= maxSize) {
        currentChunk += (currentChunk ? " " : "") + word;
      } else {
        if (currentChunk) {
          chunks.push({
            content: currentChunk,
            heading,
            startOffset: currentOffset,
            endOffset: currentOffset + currentChunk.length,
            index: chunkIndex++,
          });
          currentOffset += currentChunk.length + 1;
        }
        currentChunk = word;
      }
    }

    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        heading,
        startOffset: currentOffset,
        endOffset: currentOffset + currentChunk.length,
        index: chunkIndex,
      });
    }

    return chunks;
  }

  private mergeSmallChunks(chunks: Chunk[], minSize: number, maxSize: number): Chunk[] {
    if (chunks.length <= 1) return chunks;

    const merged: Chunk[] = [];
    let i = 0;

    while (i < chunks.length) {
      const currentChunk = chunks[i]!;
      let current: Chunk = { ...currentChunk };
      
      while (
        current.content.length < minSize &&
        i + 1 < chunks.length &&
        current.content.length + chunks[i + 1]!.content.length + 2 <= maxSize
      ) {
        i++;
        const nextChunk = chunks[i]!;
        current.content += "\n\n" + nextChunk.content;
        current.endOffset = nextChunk.endOffset;
      }

      merged.push(current);
      i++;
    }

    return merged.map((chunk, idx) => ({ ...chunk, index: idx }));
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let textChunker: TextChunker | null = null;

export function getTextChunker(): TextChunker {
  if (!textChunker) {
    textChunker = new TextChunker();
  }
  return textChunker;
}
