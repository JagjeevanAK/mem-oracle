'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

let idCounter = 0;

export function Mermaid({ chart }: { chart: string }) {
  const [mounted, setMounted] = useState(false);
  const [svg, setSvg] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>('');
  const lastRenderRef = useRef<{ chart: string; theme: string | undefined } | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
    idRef.current = `mermaid-${++idCounter}`;
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current || !idRef.current) return;
    
    const cacheKey = { chart, theme: resolvedTheme };
    if (
      lastRenderRef.current?.chart === chart &&
      lastRenderRef.current?.theme === resolvedTheme
    ) {
      return;
    }
    
    const container = containerRef.current;
    lastRenderRef.current = cacheKey;

    async function renderChart() {
      const { default: mermaid } = await import('mermaid');

      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          fontFamily: 'inherit',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        });

        const { svg: rawSvg, bindFunctions } = await mermaid.render(
          `${idRef.current}-${resolvedTheme}-${Date.now()}`,
          chart.replaceAll('\\n', '\n'),
        );

        // Fix dark mode text colors by post-processing SVG
        let svg = rawSvg;
        if (resolvedTheme === 'dark') {
          svg = rawSvg
            .replace(/fill="#000000"/g, 'fill="#e0e0e0"')
            .replace(/fill="#000"/g, 'fill="#e0e0e0"')
            .replace(/fill="black"/g, 'fill="#e0e0e0"')
            .replace(/fill:#000000/g, 'fill:#e0e0e0')
            .replace(/fill:#000;/g, 'fill:#e0e0e0;')
            .replace(/fill:black/g, 'fill:#e0e0e0')
            .replace(/stroke="#000000"/g, 'stroke="#a0a0a0"')
            .replace(/stroke="#000"/g, 'stroke="#a0a0a0"')
            .replace(/stroke:black/g, 'stroke:#a0a0a0')
            .replace(/stroke:#000;/g, 'stroke:#a0a0a0;');
        }

        bindFunctions?.(container);
        setSvg(svg);
      } catch (error) {
        console.error('Error while rendering mermaid', error);
      }
    }

    void renderChart();
  }, [chart, mounted, resolvedTheme]);

  if (!mounted) {
    return <div className="my-6 flex justify-center overflow-x-auto min-h-[200px]" />;
  }

  return (
    <div
      ref={containerRef}
      className="my-6 flex justify-center overflow-x-auto [&_text]:dark:fill-gray-200! [&_.messageText]:dark:fill-gray-200! [&_.loopText]:dark:fill-gray-200! [&_.labelText]:dark:fill-gray-200!"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
