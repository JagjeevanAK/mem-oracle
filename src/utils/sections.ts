export interface SectionInfo {
  sectionRoot: string | null;
  sectionPath: string | null;
}

const COMMON_ROOT_SEGMENTS = new Set([
  "docs",
  "doc",
  "documentation",
  "api",
  "reference",
  "references",
  "learn",
]);

const SECTION_SYNONYMS: Array<{ slug: string; phrases: string[] }> = [
  { slug: "getting-started", phrases: ["getting started", "get started", "quickstart", "quick start"] },
  { slug: "installation", phrases: ["installation", "install", "setup", "set up"] },
  { slug: "migrations", phrases: ["migration", "migrations", "migrate"] },
  { slug: "api-reference", phrases: ["api reference", "reference", "api docs"] },
  { slug: "configuration", phrases: ["configuration", "config", "settings"] },
  { slug: "guides", phrases: ["guide", "guides", "how to", "how-to"] },
  { slug: "tutorials", phrases: ["tutorial", "tutorials"] },
  { slug: "examples", phrases: ["example", "examples", "sample", "samples"] },
  { slug: "cli", phrases: ["cli", "command line", "commands"] },
];

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "with",
  "from",
  "by",
  "about",
  "is",
  "are",
  "be",
  "can",
  "how",
  "what",
  "where",
  "when",
  "why",
]);

export function deriveSectionInfoFromPath(path: string): SectionInfo {
  const segments = getCleanPathSegments(path);
  const sectionRoot = segments[0] ?? null;
  const sectionPath = segments.length >= 2
    ? `${segments[0]}/${segments[1]}`
    : sectionRoot;
  return { sectionRoot, sectionPath };
}

export function extractSectionTokensFromQuery(query: string): string[] {
  const normalized = normalizeText(query);
  const tokens = normalized
    .split(" ")
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
  const tokenSet = new Set(tokens);

  for (const entry of SECTION_SYNONYMS) {
    for (const phrase of entry.phrases) {
      if (normalized.includes(phrase)) {
        tokenSet.add(entry.slug);
        for (const part of entry.slug.split("-")) {
          tokenSet.add(part);
        }
        break;
      }
    }
  }

  return Array.from(tokenSet);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getCleanPathSegments(path: string): string[] {
  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [];
  }

  if (isLocaleSegment(segments[0])) {
    segments.shift();
  }

  const root = segments[0]?.toLowerCase();
  if (root && COMMON_ROOT_SEGMENTS.has(root)) {
    segments.shift();
  }

  return segments;
}

function isLocaleSegment(segment: string | undefined): boolean {
  if (!segment) {
    return false;
  }
  return /^[a-z]{2}(-[a-z]{2})?$/i.test(segment);
}
