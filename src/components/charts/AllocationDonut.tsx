import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "../../lib/types";
import { categoryColor } from "../../lib/colors";
import { formatBRL, formatPct } from "../../lib/format";

export function AllocationDonut({
  slices,
  centerLabel,
  centerValue,
  height = 260,
}: {
  slices: AllocationSlice[];
  centerLabel?: string;
  centerValue?: string;
  height?: number;
}) {
  const data = slices.map((s) => ({
    name: s.key,
    value: Math.round(s.balance * 100) / 100,
    pct: s.pct,
  }));

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={categoryColor(d.name)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [
              `${formatBRL(value)} (${formatPct(data.find((d) => d.name === name)?.pct ?? 0)})`,
              name,
            ]}
            contentStyle={{
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
          <span className="text-lg font-bold text-foreground">{centerValue}</span>
        </div>
      )}
    </div>
  );
}
