import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/useAuth";
import { usePortfolio, useTargets } from "../hooks/usePortfolio";
import { saveTargets } from "../lib/firestore";
import {
  compareWithTargets,
  groupBy,
  targetsSum,
  type DeltaRow,
} from "../lib/allocation";
import { ASSET_CLASSES, PRODUCT_TYPES } from "../lib/types";
import { formatBRL, formatPct } from "../lib/format";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Tabs } from "../components/ui/Tabs";
import { PageLoader } from "../components/ui/StatCard";
import { CHART, categoryColor } from "../lib/colors";
import { cn } from "../lib/utils";

type Dimension = "assetClass" | "productType";

export function CarteiraIdealPage() {
  const { user } = useAuth();
  const { positions, loading } = usePortfolio();
  const { targets, loading: loadingTargets } = useTargets();
  const [dim, setDim] = useState<Dimension>("assetClass");
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const categories = dim === "assetClass" ? ASSET_CLASSES : PRODUCT_TYPES;
  const saved = dim === "assetClass" ? targets?.byAssetClass : targets?.byProductType;

  useEffect(() => {
    setDraft(saved ?? {});
    setDirty(false);
  }, [dim, saved]);

  const sum = targetsSum(draft);
  const deltas: DeltaRow[] = useMemo(
    () => compareWithTargets(positions, dirty ? draft : (saved ?? {}), dim),
    [positions, draft, saved, dim, dirty],
  );

  const chartData = deltas.map((d) => ({
    name: d.key.length > 18 ? d.key.slice(0, 17) + "…" : d.key,
    full: d.key,
    Atual: Math.round(d.currentPct * 1000) / 10,
    Ideal: Math.round(d.targetPct * 1000) / 10,
  }));

  async function save() {
    if (!user) return;
    if (Math.abs(sum - 100) > 0.05) {
      toast.error(`A soma deve ser 100% (atual: ${sum.toFixed(1)}%)`);
      return;
    }
    setSaving(true);
    try {
      await saveTargets(user.uid, {
        byAssetClass: dim === "assetClass" ? draft : (targets?.byAssetClass ?? {}),
        byProductType:
          dim === "productType" ? draft : (targets?.byProductType ?? {}),
      });
      toast.success("Carteira ideal salva");
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading || loadingTargets) return <PageLoader />;

  const byDim = groupBy(positions, dim);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Carteira Ideal</h1>
        <p className="text-sm text-muted-foreground">
          Defina a alocação alvo e compare com a carteira atual. Valores em % —
          a soma deve ser 100%.
        </p>
      </div>

      <Tabs
        tabs={[
          { id: "assetClass", label: "Por classe de ativo" },
          { id: "productType", label: "Por tipo de produto" },
        ]}
        active={dim}
        onChange={(id) => setDim(id as Dimension)}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* editor de alvos */}
        <Card>
          <CardHeader
            title="Alocação alvo (%)"
            subtitle={
              <span
                className={cn(
                  "font-semibold",
                  Math.abs(sum - 100) <= 0.05
                    ? "text-accent"
                    : "text-destructive",
                )}
              >
                Soma: {sum.toFixed(1)}%
              </span>
            }
            action={
              <Button
                size="sm"
                onClick={save}
                disabled={saving || !dirty}
              >
                <Save className="h-4 w-4" /> Salvar
              </Button>
            }
          />
          <CardContent className="space-y-2.5">
            {categories.map((c) => {
              const hasPositions = byDim.some((s) => s.key === c);
              return (
                <div key={c} className="flex items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor(c) }}
                  />
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      !hasPositions && "text-muted-foreground",
                    )}
                  >
                    {c}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    className="h-9 w-24 text-right"
                    value={draft[c] ?? ""}
                    placeholder="0"
                    onChange={(e) => {
                      setDraft((d) => ({
                        ...d,
                        [c]: e.target.value === "" ? 0 : Number(e.target.value),
                      }));
                      setDirty(true);
                    }}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* gráfico comparativo */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Atual vs Ideal"
            subtitle="Alocação em % do total da carteira"
          />
          <CardContent>
            {positions.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Importe uma planilha para comparar com sua carteira ideal.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} layout="vertical" barGap={4}>
                  <CartesianGrid stroke={CHART.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    stroke={CHART.grid}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 11 }}
                    stroke={CHART.grid}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v}%`}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.full ?? ""
                    }
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                      fontSize: 12,
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="Atual"
                    fill={CHART.current}
                    radius={[0, 4, 4, 0]}
                    barSize={14}
                  />
                  <Bar
                    dataKey="Ideal"
                    fill={CHART.target}
                    radius={[0, 4, 4, 0]}
                    barSize={14}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* tabela de rebalanceamento */}
      {positions.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Rebalanceamento"
            subtitle="Quanto aplicar ou resgatar em cada categoria para atingir o alvo"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Categoria</th>
                  <th className="px-3 py-2.5 text-right font-medium">Atual</th>
                  <th className="px-3 py-2.5 text-right font-medium">Alvo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Atual R$</th>
                  <th className="px-3 py-2.5 text-right font-medium">Alvo R$</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {deltas.map((d) => (
                  <tr
                    key={d.key}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2 font-medium">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: categoryColor(d.key) }}
                        />
                        {d.key}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatPct(d.currentPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatPct(d.targetPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">
                      {formatBRL(d.currentBRL)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">
                      {formatBRL(d.targetBRL)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {Math.abs(d.deltaBRL) < 1 ? (
                        <span className="text-muted-foreground">ok</span>
                      ) : (
                        <span
                          className={cn(
                            "font-semibold",
                            d.deltaBRL > 0 ? "text-accent" : "text-destructive",
                          )}
                        >
                          {d.deltaBRL > 0 ? "aplicar" : "resgatar"}{" "}
                          {formatBRL(Math.abs(d.deltaBRL))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
