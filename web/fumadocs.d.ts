declare module 'fumadocs-mdx:collections/server' {
  import type { Source, MetaData } from 'fumadocs-core/source';
  import type { TableOfContents } from 'fumadocs-core/server';
  import type { MDXComponents } from 'mdx/types';
  import type { ReactNode } from 'react';

  interface MDXBody {
    (props: { components?: MDXComponents }): ReactNode;
  }

  interface PageData {
    title: string;
    description?: string;
    body: MDXBody;
    toc: TableOfContents;
    structuredData: unknown;
    [key: string]: unknown;
  }

  interface Page {
    url: string;
    slugs: string[];
    data: PageData;
  }

  interface DocsCollection {
    toFumadocsSource: () => Source<{
      pageData: PageData;
      metaData: MetaData;
    }>;
    getPages: () => Page[];
    getMeta?: () => MetaData[];
  }

  export const docs: DocsCollection;
}

declare module 'fumadocs-mdx:collections' {
  export * from 'fumadocs-mdx:collections/server';
}
