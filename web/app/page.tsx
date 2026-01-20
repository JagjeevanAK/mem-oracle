import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-fd-background">
      <main className="flex max-w-3xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-4xl font-bold tracking-tight text-fd-foreground sm:text-5xl">
            mem-oracle
          </h1>
          <p className="max-w-xl text-lg text-fd-muted-foreground">
            A locally-running documentation oracle that indexes web docs and
            injects relevant snippets into your coding context.
          </p>
        </div>

        {/* <div className="flex flex-col items-center gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureCard
              title="Local Storage"
              description="SQLite metadata + disk-based vector store with no external dependencies"
            />
            <FeatureCard
              title="Pluggable Embeddings"
              description="Local TF-IDF fallback, or use OpenAI, Voyage, or Cohere APIs"
            />
            <FeatureCard
              title="Claude Code Plugin"
              description="Auto-inject relevant documentation snippets into your prompts"
            />
            <FeatureCard
              title="MCP Server"
              description="Explicit tool calls for search and index operations"
            />
          </div>
        </div> */}

        <div className="flex flex-col gap-4 sm:flex-row">
          <Link
            href="/docs"
            className="inline-flex h-11 items-center justify-center rounded-md bg-fd-primary px-6 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Get Started
          </Link>
          <Link
            href="https://github.com/jagjeevanak/mem-oracle"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-md border border-fd-border px-6 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            View on GitHub
          </Link>
        </div>

        <div className="mt-8 rounded-lg border border-fd-border bg-fd-card p-6">
          <p className="mb-3 text-sm font-medium text-fd-muted-foreground">
            Quick Install
          </p>
          <code className="rounded bg-fd-muted px-3 py-2 font-mono text-sm text-fd-foreground">
            /plugin add jagjeevanak/mem-oracle && /plugin install mem-oracle
          </code>
        </div>
      </main>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-4 text-left">
      <h3 className="mb-1 font-semibold text-fd-foreground">{title}</h3>
      <p className="text-sm text-fd-muted-foreground">{description}</p>
    </div>
  );
}
