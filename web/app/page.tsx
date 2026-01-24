import Link from "next/link";
import { cache } from "react";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { highlight } from "fumadocs-core/highlight";
import { BrandName } from "@/components/brand-name";

const highlightBash = cache(function highlightBash(code: string) {
  return highlight(code, {
    lang: "bash",
    themes: { light: "github-light", dark: "vesper" },
  });
});

export default async function Home() {
  const [marketplaceCode, installCode] = await Promise.all([
    highlightBash(`/plugin marketplace add jagjeevanak/mem-oracle`),
    highlightBash(`/plugin install mem-oracle`),
  ]);

  return (
    <div className="fd-dotted-bg flex min-h-screen flex-col items-center justify-center bg-fd-background">
      <main className="flex w-full max-w-3xl min-w-0 flex-col items-center gap-6 px-4 py-10 text-center sm:gap-8 sm:px-6 sm:py-16">
        <div className="flex flex-col items-center gap-3 sm:gap-4">
          <h1 className="font-claude text-3xl font-bold tracking-tight text-fd-foreground sm:text-5xl">
            <BrandName />
          </h1>
          <p className="max-w-xl text-base text-fd-muted-foreground sm:text-lg">
            A locally-running documentation oracle that indexes web docs and
            injects relevant snippets into your coding context.
          </p>
        </div>


        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/docs"
            className="group inline-flex h-11 w-[200px] items-center justify-center gap-1 whitespace-nowrap rounded-md bg-fd-primary px-6 text-sm font-medium text-fd-primary-foreground transition-all hover:bg-fd-primary/90"
          >
            Get Started
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-0 overflow-hidden transition-all duration-200 group-hover:w-4"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          <Link
            href="https://github.com/jagjeevanak/mem-oracle"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-[200px] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-fd-border px-6 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5 shrink-0"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Star us on GitHub
          </Link>
        </div>

        <div className="mt-6 w-full max-w-full text-left shell-prompt sm:mt-8 sm:max-w-xl">
          <div className="relative grid gap-3 sm:gap-4 [--step-gap:0.75rem] sm:[--step-gap:1rem]">
            <div className="relative pl-0 sm:pl-12">
              <div
                aria-hidden="true"
                className="absolute left-[20px] top-1/2 hidden h-[calc(100%+var(--step-gap))] w-px sm:block"
                style={{
                  backgroundColor: "white",
                }}
              />
              <div className="absolute left-[7px] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-fd-background text-xs font-semibold leading-none text-fd-foreground sm:flex">
                1
              </div>
              <CodeBlock title="Step 1: Add Marketplace">
                <Pre>{marketplaceCode}</Pre>
              </CodeBlock>
            </div>
            <div className="relative pl-0 sm:pl-12">
              <div className="absolute left-[7px] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-fd-background text-xs font-semibold leading-none text-fd-foreground sm:flex">
                2
              </div>
              <CodeBlock title="Step 2: Install Plugin">
                <Pre>{installCode}</Pre>
              </CodeBlock>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
