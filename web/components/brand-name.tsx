import type { ComponentProps } from "react";

export function BrandName({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={`brand-name font-claude ${className ?? ""}`} {...props}>
      Mem - <span className="fd-orange">Oracle</span>
    </span>
  );
}

