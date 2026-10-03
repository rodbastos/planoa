import { formatBRL, formatPct } from "../../lib/format";
import { categoryColor } from "../../lib/colors";
import type { AllocationSlice } from "../../lib/types";

/** Lista de barras horizontais por categoria (valor + %) */
export function AllocationBars({ slices }: { slices: AllocationSlice[] }) {
  if (slices.length === 0)
    return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <div className="space-y-3">
      {slices.map((s) => (
        <div key={s.key}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium text-foreground">{s.key}</span>
            <span className="text-xs text-muted-foreground">
              {formatBRL(s.balance)} · {formatPct(s.pct)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(s.pct * 100, 1.5)}%`,
                backgroundColor: categoryColor(s.key),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
