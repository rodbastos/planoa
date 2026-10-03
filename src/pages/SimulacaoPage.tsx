import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { Download, Save, Trash2, Upload } from "lucide-react";
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
import { useRetirementPlan, useWealthYears } from "../hooks/usePortfolio";
import { importDate, useImports } from "../hooks/useImports";
import { saveRetirement, saveWealth } from "../lib/firestore";
import {
  coastFire,
  dynamicsFromImports,
  dynamicsFromWealth,
  realAnnualRate,
  simulateEstimated,
  simulateRetirement,
  yearEndTs,
} from "../lib/retirement";
import { parseWealthCsv } from "../lib/wealth-csv";
import type { RetirementPlan } from "../lib/types";
import { formatBRL, formatBRLCompact, formatPct } from "../lib/format";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { PageLoader, StatCard } from "../components/ui/StatCard";
import { CHART } from "../lib/colors";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const DEFAULT_PLAN: RetirementPlan = {
  nominalReturnPct: 12,
  inflationPct: 4.5,
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
  const { years, loading: loadingWealth } = useWealthYears();
  const { imports, loading: loadingImports } = useImports();
  const [draft, setDraft] = useState<RetirementPlan>(DEFAULT_PLAN);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const [uploadingCsv, setUploadingCsv] = useState(false);

  // Preenche o draft: plano salvo, ou defaults (valor inicial = patrimônio atual)
  useEffect(() => {
    if (dirty || loadingPlan || loadingImports || loadingWealth) return;
    if (savedPlan) {
      // merge com defaults: planos salvos antes de novos campos
      const merged = { ...DEFAULT_PLAN, ...savedPlan };
      // legado: plano salvo com "realReturnPct" -> converte para nominal
      const legacy = (savedPlan as { realReturnPct?: number }).realReturnPct;
      if (savedPlan.nominalReturnPct === undefined && legacy !== undefined) {
        merged.nominalReturnPct =
          ((1 + legacy / 100) * (1 + merged.inflationPct / 100) - 1) * 100;
      }
      setDraft(merged);
    } else {
      setDraft({
        ...DEFAULT_PLAN,
        initialValue:
          imports[0]?.patrimonio ??
          years[years.length - 1]?.final ??
          DEFAULT_PLAN.initialValue,
      });
    }
  }, [savedPlan, imports, years, dirty, loadingPlan, loadingImports, loadingWealth]);

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
        date: importDate(imp),
        patrimonio: imp.patrimonio,
      })),
    [imports],
  );

  // pontos anuais do CSV da XP (fim de ano; ano corrente = YTD)
  const wealthPoints = useMemo(() => {
    const now = Date.now();
    return years.map((y) => ({
      date: yearEndTs(y.year, now),
      patrimonio: y.final,
    }));
  }, [years]);

  const historyPoints = useMemo(
    () =>
      [...effectiveImports, ...wealthPoints].sort((a, b) => a.date - b.date),
    [effectiveImports, wealthPoints],
  );

  // dinâmica da trajetória: CSV (aporte e rendimento separados) > fallback
  // linear a partir das importações
  const dynamics = useMemo(
    () =>
      years.length > 0
        ? dynamicsFromWealth(years, draft.inflationPct)
        : dynamicsFromImports(effectiveImports),
    [years, effectiveImports, draft.inflationPct],
  );

  const result = useMemo(() => simulateRetirement(draft), [draft]);
  const coast = useMemo(() => coastFire(draft), [draft]);
  const estimate = useMemo(() => {
    const anchor = historyPoints[historyPoints.length - 1];
    if (!dynamics || !anchor) return null;
    return simulateEstimated(anchor, dynamics, draft);
  }, [historyPoints, dynamics, draft]);

  const rows = useMemo<ChartRow[]>(() => {
    const now = Date.now();
    const map = new Map<number, ChartRow>();
    // histórico: cada observação vira um ponto na idade correspondente
    for (const imp of historyPoints) {
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
  }, [historyPoints, estimate, result, draft.currentAge]);

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

  async function handleCsv(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !user) return;
    try {
      const parsed = parseWealthCsv(await f.text());
      if (parsed.length === 0) {
        toast.error("Nenhum ano encontrado no CSV");
        return;
      }
      setUploadingCsv(true);
      await saveWealth(user.uid, parsed);
      toast.success(
        `${parsed.length} anos carregados (${parsed[0].year}–${parsed[parsed.length - 1].year})`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao ler CSV");
    } finally {
      setUploadingCsv(false);
    }
  }

  async function removeWealth() {
    if (!user) return;
    try {
      await saveWealth(user.uid, []);
      toast.success("Histórico anual removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  if (loadingPlan || loadingImports || loadingWealth) return <PageLoader />;

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Rentabilidade histórica"
          value={
            estimate?.nominalAnnualRate !== undefined
              ? formatPct(estimate.nominalAnnualRate)
              : "—"
          }
          hint={
            estimate?.nominalAnnualRate !== undefined
              ? "a.a. nominal, média do seu histórico"
              : "envie o CSV anual para estimar"
          }
        />
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
            subtitle="Rentabilidade nominal convertida a termos reais pela inflação"
            action={
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                <Save className="h-4 w-4" /> Salvar
              </Button>
            }
          />
          <CardContent className="space-y-3">
            <PlanField
              label="Rentabilidade anual total"
              suffix="% a.a."
              step={0.5}
              value={draft.nominalReturnPct}
              onChange={set("nominalReturnPct")}
            />
            <PlanField
              label="Inflação esperada"
              suffix="% a.a."
              step={0.5}
              value={draft.inflationPct}
              onChange={set("inflationPct")}
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

        <Card>
          <CardHeader
            title="Histórico anual (CSV da XP)"
            subtitle={
              years.length > 0
                ? `${years[0].year}–${years[years.length - 1].year} · ${years.length} anos`
                : "patrimônio, movimentações e rendimento por ano"
            }
            action={
              years.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={removeWealth} title="Remover">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              ) : undefined
            }
          />
          <CardContent className="space-y-3">
            <input
              ref={csvRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCsv}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => csvRef.current?.click()}
                disabled={uploadingCsv}
              >
                <Upload className="h-4 w-4" />
                {years.length > 0 ? "Substituir CSV" : "Enviar CSV"}
              </Button>
              <a href="/modelo-patrimonio-anual.csv" download>
                <Button variant="ghost" size="sm">
                  <Download className="h-4 w-4" /> Baixar modelo
                </Button>
              </a>
            </div>
            <p className="text-xs text-muted-foreground">
              Uma linha por ano. "Movimentações" = aportes − resgates;
              "Rendimento" = ganho do ano em R$.
            </p>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 xl:order-first xl:row-span-2">
          <CardHeader
            title="Patrimônio: trajetória vs planejado"
            subtitle={
              estimate
                ? estimate.nominalAnnualRate !== undefined
                  ? `trajetória observada: ${formatPct(estimate.nominalAnnualRate)} nominal → ${formatPct(estimate.annualRate)} real + ${formatBRL(estimate.monthlyContribution)}/mês`
                  : `trajetória observada ≈ ${formatPct(estimate.annualRate)} a.a. + ${formatBRL(estimate.monthlyContribution)}/mês`
                : historyPoints.length === 0
                  ? "Envie o CSV anual ou importe planilhas para ver seu histórico"
                  : "Mais um ponto de histórico permite estimar sua trajetória"
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
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Coast FIRE hoje
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">
                  {formatBRL(coast.coastToday)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {coast.alreadyCoast
                    ? "o patrimônio atual já supera esse valor"
                    : "quanto bastaria ter para nunca mais aportar"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tempo até o Coast FIRE
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">
                  {coast.alreadyCoast
                    ? "Já atingido"
                    : coast.coastAge != null
                      ? `~${(coast.coastAge - draft.currentAge).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} anos`
                      : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {coast.alreadyCoast
                    ? "aportes passam a ser opcionais"
                    : coast.coastAge != null
                      ? `por volta dos ${Math.round(coast.coastAge)} anos`
                      : "aportes atuais não cruzam a curva antes dos resgates"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  FIRE target
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">
                  {formatBRL(coast.fireTarget)}
                </p>
                <p className="text-xs text-muted-foreground">
                  meta aos {draft.retirementAge} anos, para bancar a renda até
                  os 110
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Plano projetado até{" "}
              {result.depletionAge != null
                ? `os ~${Math.floor(result.depletionAge)} anos`
                : `os ${Math.round(ultimoPonto?.age ?? draft.retirementAge)} anos`}
              , com rentabilidade de {formatPct(draft.nominalReturnPct / 100)}{" "}
              a.a. (≈ {formatPct(realAnnualRate(draft))} real)
              {estimate &&
                ` Pela trajetória observada, o patrimônio ${
                  estimate.depletionAge != null
                    ? `se esgotaria aos ~${Math.floor(estimate.depletionAge)} anos`
                    : "não se esgotaria"
                }.`}
              {imports.length === 0 &&
                years.length === 0 &&
                " Nenhum histórico ainda — envie o CSV anual ou importe planilhas para comparar."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
