import { visit } from "unist-util-visit";

function isBoundaryChar(ch: string | undefined) {
  return ch === undefined || !/[A-Za-z0-9]/.test(ch);
}

export default function remarkBrandName() {
  return (tree: unknown) => {
    visit(tree as any, "text", (node: any, index: number | undefined, parent: any) => {
      if (!parent || typeof index !== "number") return;

      const parentType = parent.type;
      if (parentType === "inlineCode" || parentType === "code") return;

      const value: string = node.value;
      if (!value) return;

      const lower = value.toLowerCase();
      const target = "mem-oracle";
      if (!lower.includes(target)) return;

      const parts: any[] = [];
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

        // Insert JSX spans instead of a BrandName component so we
        // don't rely on a global BrandName symbol in compiled MDX.
        parts.push({
          type: "mdxJsxTextElement",
          name: "span",
          attributes: [
            {
              type: "mdxJsxAttribute",
              name: "className",
              value: "brand-name font-claude",
            },
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
                  value: "fd-orange",
                },
              ],
              children: [{ type: "text", value: "Oracle" }],
            },
          ],
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

