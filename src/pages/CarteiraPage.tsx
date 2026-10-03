import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../hooks/useAuth";
import { usePortfolio } from "../hooks/usePortfolio";
import { saveRule } from "../lib/firestore";
import { ASSET_CLASSES, PRODUCT_TYPES, type Position } from "../lib/types";
import { formatBRL, formatDateISO, formatNumber, formatPct } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { PageLoader } from "../components/ui/StatCard";
import { Badge } from "../components/ui/Badge";
import { categoryColor } from "../lib/colors";
import { cn } from "../lib/utils";

type GroupBy = "assetClass" | "productType" | "sourceSection";

/** "2029-05-15" -> timestamp; qualquer outro valor conta como sem prazo (vai por último) */
function maturityKey(p: Position): number {
  if (!p.maturity) return Infinity;
  const t = new Date(p.maturity).getTime();
  return Number.isNaN(t) ? Infinity : t;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  assetClass: "Classe de ativo",
  productType: "Tipo de produto",
  sourceSection: "Seção da planilha",
};

export function CarteiraPage() {
  const { user } = useAuth();
  const { importMeta, positions, loading } = usePortfolio();
  const [groupBy, setGroupBy] = useState<GroupBy>("assetClass");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      positions.filter(
        (p) =>
          (!search ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.ticker?.toLowerCase().includes(search.toLowerCase())) &&
          (!classFilter || p.assetClass === classFilter) &&
          (!typeFilter || p.productType === typeFilter),
      ),
    [positions, search, classFilter, typeFilter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Position[]>();
    for (const p of filtered) {
      const k = p[groupBy] || "Outros";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()]
      .map(([key, items]) => ({
        key,
        items: items.sort(
          (a, b) => maturityKey(a) - maturityKey(b) || b.balance - a.balance,
        ),
        total: items.reduce((a, p) => a + p.balance, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, groupBy]);

  const totalFiltered = filtered.reduce((a, p) => a + p.balance, 0) || 1;

  async function reclassify(
    p: Position,
    field: "assetClass" | "productType",
    value: string,
  ) {
    if (!user || !importMeta) return;
    const key = p.instrumentKey ?? p.name.toUpperCase();
    setSaving(p.id ?? key);
    try {
      await saveRule(
        user.uid,
        key,
        field === "assetClass" ? { assetClass: value } : { productType: value },
        importMeta.id,
      );
      toast.success(`"${p.name}" reclassificado para ${value}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar regra");
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <PageLoader />;

  if (!importMeta) {
    return (
      <EmptyMsg text="Nenhuma carteira importada ainda. Importe sua planilha na página Importar." />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Carteira</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} de {positions.length} posições ·{" "}
          {formatBRL(totalFiltered)}
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou ticker…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-48"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
        >
          <option value="">Todas as classes</option>
          {ASSET_CLASSES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select
          className="w-52"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          {PRODUCT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Select
          className="w-52"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        >
          {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
            <option key={g} value={g}>
              Agrupar: {GROUP_LABELS[g]}
            </option>
          ))}
        </Select>
      </Card>

      {groups.map((g) => (
        <Card key={g.key} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
            <div className="flex items-center gap-3">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: categoryColor(g.key) }}
              />
              <span className="text-sm font-semibold">{g.key}</span>
              <Badge>{g.items.length} ativos</Badge>
            </div>
            <span className="text-sm font-semibold">
              {formatBRL(g.total)}{" "}
              <span className="font-normal text-muted-foreground">
                · {formatPct(g.total / totalFiltered)}
              </span>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Ativo</th>
                  <th className="px-3 py-2.5 font-medium">Classe</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                  <th className="px-3 py-2.5 text-right font-medium">% Aloc.</th>
                  <th className="px-3 py-2.5 text-right font-medium">Qtd.</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rentab.</th>
                  <th className="px-5 py-2.5 text-right font-medium">Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((p) => {
                  const rowSaving = saving === (p.id ?? p.instrumentKey);
                  return (
                    <tr
                      key={p.id ?? `${p.name}-${p.maturity ?? ""}`}
                      className={cn(
                        "border-b border-border/60 last:border-0 hover:bg-muted/30",
                        rowSaving && "opacity-50",
                      )}
                    >
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-foreground">
                          {p.ticker ?? p.name}
                        </div>
                        {p.ticker && p.ticker !== p.name && (
                          <div className="text-xs text-muted-foreground">
                            {p.name}
                          </div>
                        )}
                        {!p.ticker && (
                          <div className="text-xs text-muted-foreground">
                            {p.sourceSection}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          className="w-44"
                          value={p.assetClass}
                          onChange={(e) =>
                            reclassify(p, "assetClass", e.target.value)
                          }
                        >
                          {[...ASSET_CLASSES, "Multimercado", "Outros"].map(
                            (c) => (
                              <option key={c}>{c}</option>
                            ),
                          )}
                          {![...ASSET_CLASSES, "Multimercado", "Outros"].includes(
                            p.assetClass as never,
                          ) && <option>{p.assetClass}</option>}
                        </Select>
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          className="w-48"
                          value={p.productType}
                          onChange={(e) =>
                            reclassify(p, "productType", e.target.value)
                          }
                        >
                          {PRODUCT_TYPES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                          {!PRODUCT_TYPES.includes(p.productType as never) && (
                            <option>{p.productType}</option>
                          )}
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {formatBRL(p.balance)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">
                        {formatPct(p.balance / totalFiltered)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">
                        {formatNumber(p.quantity)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">
                        {p.yieldText ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground">
                        {formatDateISO(p.maturity)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
