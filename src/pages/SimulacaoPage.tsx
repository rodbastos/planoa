import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/useAuth";
import { useRetirementPlan } from "../hooks/usePortfolio";
import { saveRetirement, subscribeImports } from "../lib/firestore";
import { simulateEstimated, simulateRetirement } from "../lib/retirement";
import type { ImportMeta, RetirementPlan } from "../lib/types";
import { formatBRL, formatBRLCompact, formatPct } from "../lib/format";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { PageLoader, StatCard } from "../components/ui/StatCard";
import { CHART } from "../lib/colors";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const DEFAULT_PLAN: RetirementPlan = {
  realReturnPct: 7,
  currentAge: 49,
  retirementAge: 64,
  initialValue: 1_500_000,
  monthlyContribution: 5_000,
  desiredMonthlyIncome: 35_000,
};

interface ChartRow {
  idade: number;
  historico?: number;
  estimado?: number;
  planejado?: number;
}

const SERIES_NAMES: Record<string, string> = {
  historico: "Histórico",
  estimado: "Estimado (trajetória)",
  planejado: "Planejado",
};

function PlanField({
  label,
  prefix,
  suffix,
  ...props
}: {
  label: string;
  prefix?: string;
  suffix?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          {...props}
          type="number"
          className={`text-right ${prefix ? "pl-9" : ""} ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

export function SimulacaoPage() {
  const { user } = useAuth();
  const { plan: savedPlan, loading: loadingPlan } = useRetirementPlan();
  const [imports, setImports] = useState<ImportMeta[]>([]);
  const [loadingImports, setLoadingImports] = useState(true);
  const [draft, setDraft] = useState<RetirementPlan>(DEFAULT_PLAN);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    return subscribeImports(user.uid, (list) => {
      setImports(list);
      setLoadingImports(false);
    });
  }, [user]);

  // Preenche o draft: plano salvo, ou defaults (valor inicial = patrimônio atual)
  useEffect(() => {
    if (dirty || loadingPlan || loadingImports) return;
    if (savedPlan) {
      setDraft(savedPlan);
    } else {
      setDraft({
        ...DEFAULT_PLAN,
        initialValue: imports[0]?.patrimonio ?? DEFAULT_PLAN.initialValue,
      });
    }
  }, [savedPlan, imports, dirty, loadingPlan, loadingImports]);

  const set =
    (key: keyof RetirementPlan) => (e: ChangeEvent<HTMLInputElement>) => {
      setDraft((d) => ({
        ...d,
        [key]: e.target.value === "" ? 0 : Number(e.target.value),
      }));
      setDirty(true);
    };

  // data efetiva de cada snapshot: data de referência do relatório, senão upload
  const effectiveImports = useMemo(
    () =>
      imports.map((imp) => ({
        date: imp.referenceDate ?? imp.uploadedAt,
        patrimonio: imp.patrimonio,
        totalInvestido: imp.totalInvestido,
      })),
    [imports],
  );

  const result = useMemo(() => simulateRetirement(draft), [draft]);
  const estimate = useMemo(
    () => simulateEstimated(effectiveImports, draft),
    [effectiveImports, draft],
  );

  const rows = useMemo<ChartRow[]>(() => {
    const now = Date.now();
    const map = new Map<number, ChartRow>();
    // histórico: cada importação vira um ponto na idade correspondente
    for (const imp of effectiveImports) {
      const age = draft.currentAge + (imp.date - now) / MS_PER_YEAR;
      const key = Math.round(age * 100) / 100;
      map.set(key, { idade: key, historico: imp.patrimonio });
    }
    // estimado: continuação da trajetória observada
    for (const p of estimate?.points ?? []) {
      const key = Math.round(p.age * 100) / 100;
      const row = map.get(key) ?? { idade: key };
      row.estimado = Math.round(p.patrimonio);
      map.set(key, row);
    }
    for (const p of result.points) {
      const key = Math.round(p.age * 100) / 100;
      const row = map.get(key) ?? { idade: key };
      row.planejado = Math.round(p.patrimonio);
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.idade - b.idade);
  }, [effectiveImports, estimate, result, draft.currentAge]);

  const ageTicks = useMemo(() => {
    if (rows.length === 0) return [];
    const min = Math.floor(rows[0].idade);
    const max = Math.ceil(rows[rows.length - 1].idade);
    const step = Math.max(1, Math.round((max - min) / 12));
    const ticks: number[] = [];
    for (let t = min; t <= max; t += step) ticks.push(t);
    return ticks;
  }, [rows]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await saveRetirement(user.uid, draft);
      toast.success("Plano de aposentadoria salvo");
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loadingPlan || loadingImports) return <PageLoader />;

  const faseResgate = draft.retirementAge <= draft.currentAge;
  const ultimoPonto = result.points[result.points.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Simulação de aposentadoria</h1>
        <p className="text-sm text-muted-foreground">
          Projeção em valores reais do patrimônio, comparada ao histórico das
          suas importações.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Patrimônio real acumulado"
          value={formatBRL(result.accumulated)}
          hint={`aos ${draft.retirementAge} anos`}
        />
        <StatCard
          label="Percentual anual de retirada"
          value={formatPct(result.annualWithdrawalRate)}
          hint={`${formatBRL(draft.desiredMonthlyIncome)}/mês sobre o acumulado`}
        />
        <StatCard
          label="Idade para o fim do patrimônio"
          value={
            result.depletionAge != null
              ? `~${Math.floor(result.depletionAge)} anos`
              : "Não se esgota"
          }
          hint={
            result.depletionAge != null
              ? "idade em que o saldo zera"
              : `renda mensal coberta pelos juros reais`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="Parâmetros do plano"
            subtitle="Valores em reais de hoje"
            action={
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                <Save className="h-4 w-4" /> Salvar
              </Button>
            }
          />
          <CardContent className="space-y-3">
            <PlanField
              label="Rentabilidade real esperada"
              suffix="% a.a."
              step={0.5}
              value={draft.realReturnPct}
              onChange={set("realReturnPct")}
            />
            <PlanField
              label="Sua idade"
              suffix="anos"
              min={0}
              step={1}
              value={draft.currentAge}
              onChange={set("currentAge")}
            />
            <PlanField
              label="Idade para começar o resgate"
              suffix="anos"
              min={0}
              step={1}
              value={draft.retirementAge}
              onChange={set("retirementAge")}
            />
            <PlanField
              label="Valor inicial"
              prefix="R$"
              step={10000}
              value={draft.initialValue}
              onChange={set("initialValue")}
            />
            <PlanField
              label="Aporte mensal"
              prefix="R$"
              step={500}
              value={draft.monthlyContribution}
              onChange={set("monthlyContribution")}
            />
            <PlanField
              label="Renda passiva mensal desejada"
              prefix="R$"
              step={1000}
              value={draft.desiredMonthlyIncome}
              onChange={set("desiredMonthlyIncome")}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Patrimônio: trajetória vs planejado"
            subtitle={
              estimate
                ? `trajetória observada ≈ ${formatPct(estimate.annualRate)} a.a. + ${formatBRL(estimate.monthlyContribution)}/mês`
                : imports.length === 0
                  ? "Importe planilhas para ver seu histórico no gráfico"
                  : "Importe mais uma planilha para estimar sua trajetória"
            }
          />
          <CardContent>
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 8 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="idade"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  ticks={ageTicks}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke={CHART.grid}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                />
                <YAxis
                  width={82}
                  domain={[0, "auto"]}
                  tickFormatter={formatBRLCompact}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke={CHART.grid}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    formatBRL(v),
                    SERIES_NAMES[name] ?? name,
                  ]}
                  labelFormatter={(l) =>
                    `Idade ${Number.isInteger(l) ? l : Number(l).toFixed(1)}`
                  }
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--foreground)",
                    fontSize: 12,
                  }}
                />
                <Legend
                  formatter={(v: string) => SERIES_NAMES[v] ?? v}
                />
                {!faseResgate && (
                  <ReferenceLine
                    x={draft.retirementAge}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{
                      value: "Início dos resgates",
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: "var(--muted-foreground)",
                    }}
                  />
                )}
                {result.depletionAge != null && (
                  <ReferenceLine
                    x={Math.round(result.depletionAge * 100) / 100}
                    stroke="var(--destructive)"
                    strokeDasharray="4 4"
                    label={{
                      value: "Fim do patrimônio",
                      position: "insideTopLeft",
                      fontSize: 11,
                      fill: "var(--destructive)",
                    }}
                  />
                )}
                <Line
                  dataKey="historico"
                  stroke={CHART.current}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
                {/* mesma cor do histórico, tracejada: lê-se como uma curva só */}
                <Line
                  dataKey="estimado"
                  stroke={CHART.current}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                  legendType="none"
                  isAnimationActive={false}
                />
                <Line
                  dataKey="planejado"
                  stroke={CHART.planned}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Plano projetado até{" "}
              {result.depletionAge != null
                ? `os ~${Math.floor(result.depletionAge)} anos`
                : `os ${Math.round(ultimoPonto?.age ?? draft.retirementAge)} anos`}
              , com rentabilidade real de{" "}
              {formatPct(draft.realReturnPct / 100)} a.a.
              {estimate &&
                ` Pela trajetória observada, o patrimônio ${
                  estimate.depletionAge != null
                    ? `se esgotaria aos ~${Math.floor(estimate.depletionAge)} anos`
                    : "não se esgotaria"
                }.`}
              {imports.length === 0 &&
                " Nenhuma importação ainda — envie planilhas em Importar para comparar."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
