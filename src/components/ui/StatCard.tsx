import type { ReactNode } from "react";
import { Card } from "./Card";
import { cn } from "../../lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 truncate text-2xl font-bold text-foreground">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <div className="rounded-lg bg-muted p-2.5 text-accent shrink-0">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-accent",
        className,
      )}
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
