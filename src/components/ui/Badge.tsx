import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-foreground",
        className,
      )}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </span>
  );
}
