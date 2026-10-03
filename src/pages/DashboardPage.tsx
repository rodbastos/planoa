import { Link } from "react-router-dom";
import {
  ArrowRight,
  ListOrdered,
  PiggyBank,
  Upload,
  Wallet,
} from "lucide-react";
import { usePortfolio, useTargets } from "../hooks/usePortfolio";
import { groupBy, compareWithTargets, totalBalance } from "../lib/allocation";
import { formatBRL, formatPct, formatTimestamp } from "../lib/format";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { PageLoader, StatCard } from "../components/ui/StatCard";
import { Button } from "../components/ui/Button";
import { AllocationDonut } from "../components/charts/AllocationDonut";
import { AllocationBars } from "../components/charts/AllocationBars";
import { Badge } from "../components/ui/Badge";
import { categoryColor } from "../lib/colors";

export function DashboardPage() {
  const { importMeta, positions, loading } = usePortfolio();
  const { targets } = useTargets();

  if (loading) return <PageLoader />;

  if (!importMeta) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
        <img src="/logo-mark.png" alt="" className="mb-6 h-20 w-20" />
        <h1 className="text-2xl font-bold">Bem-vindo ao Plano A</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Importe a planilha "Posição Detalhada" da sua corretora para começar a
          acompanhar sua carteira.
        </p>
        <Link to="/importar" className="mt-6">
          <Button size="lg">
            <Upload className="h-4 w-4" /> Importar planilha
          </Button>
        </Link>
      </div>
    );
  }

  const byClass = groupBy(positions, "assetClass");
  const byType = groupBy(positions, "productType");
  const total = totalBalance(positions);
  const rentabilidade =
    importMeta.totalInvestido > 0
      ? (importMeta.patrimonio - importMeta.totalInvestido) /
        importMeta.totalInvestido
      : 0;

  const classTargets = targets?.byAssetClass ?? {};
  const deltas = Object.keys(classTargets).length
    ? compareWithTargets(positions, classTargets, "assetClass").slice(0, 3)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Posição de{" "}
            {formatTimestamp(importMeta.referenceDate ?? importMeta.uploadedAt)}{" "}
            · {importMeta.fileName}
          </p>
        </div>
        <Link to="/importar">
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4" /> Nova importação
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Patrimônio"
          value={formatBRL(importMeta.patrimonio)}
          hint={`${rentabilidade >= 0 ? "+" : ""}${formatPct(rentabilidade)} sobre o investido`}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="Total investido"
          value={formatBRL(importMeta.totalInvestido)}
          icon={<PiggyBank className="h-5 w-5" />}
        />
        <StatCard
          label="Saldo disponível"
          value={formatBRL(importMeta.saldoDisponivel)}
          icon={<ListOrdered className="h-5 w-5" />}
        />
        <StatCard
          label="Posições"
          value={positions.length}
          hint={`${byClass.length} classes · ${byType.length} tipos de produto`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Alocação por classe de ativo"
            subtitle={formatBRL(total)}
          />
          <CardContent>
            <AllocationDonut
              slices={byClass}
              centerLabel="Total"
              centerValue={formatBRL(total)}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {byClass.map((s) => (
                <Badge key={s.key} color={categoryColor(s.key)}>
                  {s.key} · {formatPct(s.pct)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Alocação por tipo de produto" />
          <CardContent>
            <AllocationBars slices={byType} />
          </CardContent>
        </Card>
      </div>

      {deltas.length > 0 && (
        <Card>
          <CardHeader
            title="Maiores desvios da carteira ideal"
            subtitle="Diferença entre alocação atual e alvo por classe"
            action={
              <Link to="/carteira-ideal">
                <Button variant="ghost" size="sm">
                  Ver detalhes <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            }
          />
          <CardContent>
            <div className="divide-y divide-border">
              {deltas.map((d) => (
                <div
                  key={d.key}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <span className="font-medium">{d.key}</span>
                  <span className="text-muted-foreground">
                    {formatPct(d.currentPct)} → {formatPct(d.targetPct)}
                  </span>
                  <span
                    className={
                      d.deltaBRL > 0 ? "text-accent font-semibold" : "text-destructive font-semibold"
                    }
                  >
                    {d.deltaBRL > 0 ? "aplicar" : "resgatar"}{" "}
                    {formatBRL(Math.abs(d.deltaBRL))}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
