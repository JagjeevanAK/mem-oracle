declare module 'fumadocs-mdx:collections/server' {
  import type { Source, Page, MetaData } from 'fumadocs-core/source';
  
  interface DocsCollection {
    toFumadocsSource: () => Source<{
      pageData: Page;
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
