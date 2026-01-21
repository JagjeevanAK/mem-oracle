// source.config.ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import { visit } from "unist-util-visit";
function isBoundaryChar(ch) {
  return ch === void 0 || !/[A-Za-z0-9]/.test(ch);
}
function remarkBrandName() {
  return (tree) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const parentType = parent.type;
      if (parentType === "inlineCode" || parentType === "code") return;
      const value = node.value;
      if (!value) return;
      const lower = value.toLowerCase();
      const target = "mem-oracle";
      if (!lower.includes(target)) return;
      const parts = [];
      let cursor = 0;
      while (true) {
        const next = lower.indexOf(target, cursor);
        if (next === -1) break;
        const beforeChar = value[next - 1];
        const afterChar = value[next + target.length];
        if (!isBoundaryChar(beforeChar) || !isBoundaryChar(afterChar)) {
          cursor = next + target.length;
          continue;
        }
        const before = value.slice(cursor, next);
        if (before) parts.push({ type: "text", value: before });
        parts.push({
          type: "mdxJsxTextElement",
          name: "span",
          attributes: [
            {
              type: "mdxJsxAttribute",
              name: "className",
              value: "brand-name font-claude"
            }
          ],
          children: [
            { type: "text", value: "Mem- " },
            {
              type: "mdxJsxTextElement",
              name: "span",
              attributes: [
                {
                  type: "mdxJsxAttribute",
                  name: "className",
                  value: "fd-orange"
                }
              ],
              children: [{ type: "text", value: "Oracle" }]
            }
          ]
        });
        cursor = next + target.length;
      }
      const after = value.slice(cursor);
      if (after) parts.push({ type: "text", value: after });
      if (parts.length === 0) return;
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}
var docs = defineDocs({
  dir: "content/docs"
});
var source_config_default = defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkBrandName],
    rehypePlugins: [],
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "vesper"
      }
    }
  }
});
export {
  source_config_default as default,
  docs
};
