import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer",
            active === t.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
