import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CircleHelp, Plus, RotateCcw, Scale, Target, Trash2, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ImportSelector } from "../components/ImportSelector";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { PageLoader, StatCard } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { usePortfolio, useRebalancePreferences, useTargets } from "../hooks/usePortfolio";
import { importDate } from "../hooks/useImports";
import { categoryColor, CHART } from "../lib/colors";
import { formatBRL, formatDate, formatDateISO, formatPct } from "../lib/format";
import {
  assetTargetCategories, createRebalanceAssets, simulateAssetRebalance, summarizeRebalance, validAllocation,
  type RebalanceAsset, type RebalanceDimension, type RebalanceMode, type RebalanceResult,
} from "../lib/rebalance";
import { ASSET_CLASSES, PRODUCT_TYPES, type AssetIntent, type Position, type Targets } from "../lib/types";
import { cn } from "../lib/utils";

const DIMENSIONS = [
  { id: "asset", label: "Por ativo" },
  { id: "assetClass", label: "Por classe" },
  { id: "productType", label: "Por tipo de produto" },
];
const EMPTY_TARGETS: Targets = { byAssetClass: {}, byProductType: {} };

function percentagePoints(fraction: number): string {
  const value = Math.abs(fraction) < 0.00005 ? 0 : fraction * 100;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} p.p.`;
}

function AssetLabel({ asset }: { asset: RebalanceAsset }) {
  return (
    <div className="min-w-44">
      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(asset.assetClass) }} />
      {asset.name}
      {asset.future && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">Futuro</span>}
      {asset.intent === "exit" && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">Em saída · sem aportes</span>}
      <span className="mt-1 block text-xs font-normal text-muted-foreground">
        {asset.ticker ? `${asset.ticker} · ` : ""}{asset.assetClass} · {asset.productType}
        {asset.maturity ? ` · Venc. ${formatDateISO(asset.maturity)}` : ""}
      </span>
    </div>
  );
}

export function RebalanceamentoPage() {
  const { positions, importMeta, loading, error } = usePortfolio();
  const { targets, loading: loadingTargets } = useTargets();
  const { preferences, loading: loadingPreferences, error: preferencesError, saveIntent } = useRebalancePreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const dimension: RebalanceDimension = searchParams.get("visao") === "produtos" ? "productType"
    : searchParams.get("visao") === "classes" ? "assetClass" : "asset";
  const [revision, setRevision] = useState(0);

  if (loading || loadingTargets || loadingPreferences) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
            <Scale className="h-4 w-4" /> Laboratório da carteira
          </div>
          <h1 className="text-2xl font-bold">Rebalanceamento</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Planeje compras e resgates dos seus ativos. Inclua novos investimentos apenas na simulação.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportSelector className="w-64" />
          {importMeta && <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}><RotateCcw className="h-3.5 w-3.5" /> Reiniciar cenário</Button>}
        </div>
      </div>
      {error || preferencesError ? (
        <Card className="p-5 text-sm text-destructive" role="alert">{preferencesError ? `Não foi possível carregar suas intenções por ativo. As sugestões estão suspensas para não ignorá-las: ${preferencesError}` : `Não foi possível carregar a carteira: ${error}`}</Card>
      ) : !importMeta ? (
        <Card className="px-6 py-14 text-center">
          <Scale className="mx-auto mb-4 h-10 w-10 text-accent" />
          <h2 className="text-lg font-semibold">Sua próxima decisão começa com a carteira atual</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Importe sua posição para simular aportes e planejar os ajustes de cada ativo.</p>
          <Link to="/importar" className="mt-5 inline-flex items-center gap-2 font-semibold text-accent">Importar carteira <ArrowRight className="h-4 w-4" /></Link>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Base: {formatDate(importDate(importMeta))} · Operações são simuladas. A intenção de manter ou sair é salva na sua conta.</p>
          <RebalanceScenario
            key={`${importMeta.id}:${revision}`}
            positions={positions}
            savedTargets={targets ?? EMPTY_TARGETS}
            preferences={preferences}
            onSaveIntent={saveIntent}
            dimension={dimension}
            onDimensionChange={(value) => setSearchParams(value === "asset" ? {} : { visao: value === "productType" ? "produtos" : "classes" }, { replace: true })}
          />
        </>
      )}
    </div>
  );
}

function RebalanceScenario({ positions, dimension, savedTargets, preferences, onSaveIntent, onDimensionChange }: {
  positions: Position[];
  dimension: RebalanceDimension;
  savedTargets: Targets;
  preferences: Record<string, AssetIntent>;
  onSaveIntent: (key: string, intent: AssetIntent) => Promise<void>;
  onDimensionChange: (dimension: RebalanceDimension) => void;
}) {
  const [assetDraft, setAssets] = useState(() => createRebalanceAssets(positions, savedTargets.byAssetClass));
  const assets = useMemo(() => assetDraft.map((asset): RebalanceAsset => ({ ...asset,
    intent: asset.preferenceKey ? preferences[asset.preferenceKey] ?? "keep" : "keep",
  })), [assetDraft, preferences]);
  const [savingIntent, setSavingIntent] = useState<string | null>(null);
  const [failedIntent, setFailedIntent] = useState<{ key: string; intent: AssetIntent; message: string } | null>(null);
  const [classTargets, setClassTargets] = useState({ ...savedTargets.byAssetClass });
  const [productTargets, setProductTargets] = useState({ ...savedTargets.byProductType });
  const [mode, setMode] = useState<RebalanceMode>("contribution");
  const [contribution, setContribution] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualDimension, setManualDimension] = useState<RebalanceDimension>("asset");
  const [manualPlans, setManualPlans] = useState<Record<RebalanceDimension, Record<string, number>>>({ asset: {}, assetClass: {}, productType: {} });
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const targets = dimension === "productType" ? productTargets : classTargets;
  const manual = manualPlans[manualDimension];
  const classOptions = [...new Set([...ASSET_CLASSES, ...assets.map((asset) => asset.assetClass), ...Object.keys(classTargets)])];
  const productOptions = [...new Set([...PRODUCT_TYPES, ...assets.map((asset) => asset.productType), ...Object.keys(productTargets)])];
  const groupKeys = dimension === "assetClass" ? classOptions : productOptions;
  const targetValues = dimension === "asset" ? assets.map((asset) => asset.targetPct) : Object.values(targets);
  const targetSum = targetValues.reduce((sum, value) => sum + value, 0);
  const validTargets = validAllocation(targetValues);
  const manualItems = manualDimension === "asset"
    ? assets.map((asset) => ({ key: asset.key, label: asset.name, blocked: asset.intent === "exit" }))
    : [...new Set(assets.map((asset) => asset[manualDimension]))].map((key) => ({ key, label: key, blocked: false }));
  const filteredAssets = assets.filter((asset) => `${asset.name} ${asset.ticker ?? ""} ${asset.assetClass} ${asset.productType}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const shareField = dimension === "asset" ? "targetPct" : dimension === "assetClass" ? "classSharePct" : "productSharePct";

  const { result, validationError } = useMemo(() => {
    try {
      return {
        result: simulateAssetRebalance({ assets, dimension, targets, contribution, mode, manualDimension,
          manualContributions: manualMode && mode === "contribution" ? manual : undefined }),
        validationError: null,
      };
    } catch (error) {
      return { result: null, validationError: error instanceof Error ? error.message : "Revise os valores do cenário." };
    }
  }, [assets, dimension, targets, contribution, mode, manualDimension, manualMode, manual]);

  async function changeIntent(key: string, intent: AssetIntent) {
    setSavingIntent(key);
    setFailedIntent(null);
    try {
      await onSaveIntent(key, intent);
      setAssets((current) => current.map((asset) => asset.preferenceKey === key ? { ...asset, allowExitSale: false } : asset));
      if (intent === "exit") {
        const blockedKeys = new Set(assets.filter((asset) => asset.preferenceKey === key).map((asset) => asset.key));
        setManualPlans((current) => ({ ...current, asset: Object.fromEntries(Object.entries(current.asset).filter(([id]) => !blockedKeys.has(id))) }));
      }
      toast.success(intent === "exit" ? "Intenção salva: este ativo não receberá novos aportes." : "Intenção salva: ativo disponível para novos aportes.");
    } catch (error) {
      setFailedIntent({ key, intent, message: error instanceof Error ? error.message : "Não foi possível salvar a intenção." });
    } finally {
      setSavingIntent(null);
    }
  }

  function updateAsset(key: string, patch: Partial<RebalanceAsset>) {
    setAssets((current) => current.map((asset) => asset.key === key ? { ...asset, ...patch } : asset));
    setActionError(null);
  }

  function removeFuture(key: string) {
    const remaining = assets.filter((asset) => asset.key !== key || !asset.future);
    setAssets(remaining);
    setManualPlans((current) => ({
      asset: Object.fromEntries(Object.entries(current.asset).filter(([id]) => remaining.some((asset) => asset.key === id))),
      assetClass: Object.fromEntries(Object.entries(current.assetClass).filter(([id]) => remaining.some((asset) => asset.assetClass === id))),
      productType: Object.fromEntries(Object.entries(current.productType).filter(([id]) => remaining.some((asset) => asset.productType === id))),
    }));
    setActionError(null);
  }

  function fillSuggestion() {
    try {
      const suggestion = simulateAssetRebalance({ assets, dimension, targets, contribution, mode: "contribution" });
      setManualPlans((current) => ({ ...current, asset: Object.fromEntries(suggestion.rows.map((row) => [row.key, row.tradeBRL])) }));
      setManualDimension("asset");
      setManualMode(true);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível gerar a sugestão.");
    }
  }

  function copyClassTargets() {
    try {
      const categories = assetTargetCategories(assets, "assetClass", classTargets);
      const byKey = new Map(categories.map((row) => [row.key, row.targetPct]));
      setAssets((current) => current.map((asset) => ({ ...asset, targetPct: byKey.get(asset.key) ?? 0 })));
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Revise as metas por classe.");
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Modo de rebalanceamento">
        {([
          { id: "contribution", title: "Rebalancear com novo aporte", description: "Distribua dinheiro novo entre os ativos, sem realizar vendas.", icon: Wallet },
          { id: "full", title: "Rebalancear a carteira", description: "Ajuste cada posição com compras e resgates, com ou sem aporte.", icon: Scale },
        ] as const).map(({ id, title, description, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
            className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent", mode === id ? "border-accent bg-accent/5 ring-1 ring-accent/20" : "border-border bg-card hover:border-accent/50")}>
            <div className={cn("rounded-lg p-2.5", mode === id ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-5 w-5" /></div>
            <div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div>
            <label htmlFor="rebalance-contribution" className="text-sm font-semibold">{mode === "full" ? "Aporte adicional (opcional)" : "Quanto você quer aportar?"}</label>
            <div className="relative mt-2 max-w-sm">
              <span className="absolute left-3 top-3 text-sm text-muted-foreground">R$</span>
              <Input id="rebalance-contribution" type="number" inputMode="decimal" min={0} step="0.01" value={contribution}
                onChange={(event) => setContribution(event.target.value === "" ? 0 : event.target.valueAsNumber)} className="h-12 pl-10 text-lg font-semibold tabular-nums" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{mode === "full" ? "Deixe zero para realocar somente o patrimônio existente. " : "A sugestão prioriza os ativos abaixo da meta após o aporte. "}O saldo disponível da conta não é incluído automaticamente.</p>
          </div>
          <div className="lg:border-l lg:border-border lg:pl-6">
            {mode === "contribution" ? <>
              <p className="mb-2 text-sm font-semibold">Distribuição do aporte</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Distribuição do aporte">
                <Button variant={!manualMode ? "primary" : "outline"} size="sm" aria-pressed={!manualMode} onClick={() => setManualMode(false)}>Sugerir distribuição</Button>
                <Button variant={manualMode ? "primary" : "outline"} size="sm" aria-pressed={manualMode} onClick={() => setManualMode(true)}>Definir valores</Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Use os ativos existentes como ponto de partida. Novos ativos só entram se você os adicionar ao cenário.</p>
            </> : <p className="rounded-lg bg-muted/60 p-4 text-xs leading-relaxed text-muted-foreground">O plano busca a meta de cada ativo, incluindo ajustes dentro da mesma classe. Os resgates financiam as compras; o aporte cobre a diferença. Nenhuma ordem é executada.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Como definir as metas" subtitle="A base é sempre a lista de ativos. Escolha metas individuais ou distribua uma meta de categoria entre seus ativos." />
        <CardContent id="scenario-editor" className="space-y-4">
          <div className="overflow-x-auto"><Tabs tabs={DIMENSIONS} active={dimension} onChange={(value) => { onDimensionChange(value as RebalanceDimension); setActionError(null); }} /></div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3 text-xs">
            <p className={cn("font-semibold", validTargets ? "text-accent" : "text-destructive")}>Soma das metas: {Number.isFinite(targetSum) ? formatPct(targetSum / 100) : "inválida"}{!validTargets && " · defina 100% para simular"}</p>
            {dimension === "asset" ? <Button variant="outline" size="sm" onClick={copyClassTargets}>Usar metas por classe</Button> : <Link to="/carteira-ideal" className="font-medium text-accent hover:underline">Editar metas permanentes</Link>}
          </div>
          {dimension === "asset" ? <p className="text-xs leading-relaxed text-muted-foreground">As metas iniciais por ativo vêm das metas por classe, repartidas proporcionalmente aos saldos importados. São premissas editáveis, não metas individuais salvas. Confira a soma e inclua ativos para classes ainda sem posição.</p> : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groupKeys.map((key) => {
                const members = assets.filter((asset) => asset[dimension] === key);
                const sum = members.reduce((acc, asset) => acc + asset[shareField], 0);
                return <div key={key} className="rounded-lg border border-border p-3">
                  <label className="flex items-center justify-between gap-3 text-xs font-medium">
                    {key}<Input aria-label={`Meta de ${key} (%)`} type="number" inputMode="decimal" min={0} max={100} step="0.01" value={targets[key] ?? 0}
                      onChange={(event) => (dimension === "assetClass" ? setClassTargets : setProductTargets)((current) => ({ ...current, [key]: event.target.value === "" ? 0 : event.target.valueAsNumber }))} className="h-9 w-24 shrink-0 text-right" />
                  </label>
                  <p className="mt-2 text-[11px] text-muted-foreground">{members.length} ativos · Pesos internos: {formatPct(sum / 100)}{!members.length && (targets[key] ?? 0) > 0 ? " · adicione um ativo" : ""}</p>
                </div>;
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">A meta de cada categoria é dividida pelos pesos dos ativos abaixo. Os pesos devem somar 100% dentro de cada categoria com meta positiva. O padrão usa a proporção dos saldos importados, sem mudar automaticamente com os saldos simulados.</p>
          </>}
          <p className="text-xs leading-relaxed text-muted-foreground">Ativos em saída têm meta efetiva zero e nunca recebem aportes. Suas metas e pesos base ficam guardados; a parcela é redistribuída proporcionalmente entre os ativos elegíveis. Se uma categoria ficar sem destino, ajuste sua meta ou adicione um ativo.</p>
          <p className="text-xs text-muted-foreground">Trocar a base das metas preserva os ativos, saldos e rascunhos. As metas por ativo, classe e produto são alternativas, não restrições simultâneas. Metas com soma a até 0,05 p.p. de 100% são normalizadas.</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Ativos do cenário" subtitle={`${assets.filter((asset) => !asset.future).length} posições existentes · ${assets.filter((asset) => asset.future).length} ativos futuros`}
          action={<Button size="sm" variant="outline" aria-expanded={showAddAsset} onClick={() => setShowAddAsset((value) => !value)}><Plus className="h-4 w-4" /> Adicionar ativo</Button>} />
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Manter ou sair é uma preferência permanente.</strong> Ela vale para o mesmo instrumento e vencimento nas próximas importações e não é apagada ao reiniciar o cenário. Posições do mesmo instrumento e vencimento compartilham a intenção.
            {" "}Marcar saída não presume liquidez: o saldo permanece até você permitir o resgate neste cenário. Essa permissão de resgate é temporária. Manter permite aportes e também reduções de posição para ajustar a meta.
          </div>
          {savingIntent && <p role="status" className="text-xs text-muted-foreground">Salvando intenção na sua conta. As sugestões ficam suspensas até a confirmação.</p>}
          {failedIntent && <div role="alert" className="rounded-lg border border-destructive/25 p-3 text-sm text-destructive">
            Não foi possível salvar a intenção. As sugestões estão suspensas: {failedIntent.message}
            <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => changeIntent(failedIntent.key, failedIntent.intent)}>Tentar novamente</Button><Button size="sm" variant="ghost" onClick={() => setFailedIntent(null)}>Descartar alteração</Button></div>
          </div>}
          {showAddAsset && <FutureAssetForm classOptions={classOptions} productOptions={productOptions} assets={assets}
            onCancel={() => setShowAddAsset(false)} onAdd={(asset) => { setAssets((current) => [...current, asset]); setShowAddAsset(false); setSearch(""); setActionError(null); }} />}
          <Input type="search" aria-label="Buscar ativos do cenário" placeholder="Buscar ativo, ticker, classe ou produto" value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-md" />
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Saldos e metas por ativo usados na simulação</caption>
              <thead className="sticky top-0 z-10 bg-card"><tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-3 pr-4 font-medium">Ativo</th>
                <th scope="col" className="px-3 py-3 font-medium">Intenção</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Saldo importado</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Saldo simulado (R$)</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{dimension === "asset" ? "Meta base na carteira (%)" : dimension === "assetClass" ? "Peso base na classe (%)" : "Peso base no produto (%)"}</th>
                <th scope="col"><span className="sr-only">Remover ativo futuro</span></th>
              </tr></thead>
              <tbody>{filteredAssets.map((asset) => <tr key={asset.key} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-3 pr-4 text-left font-medium"><AssetLabel asset={asset} /></th>
                <td className="px-3 py-3">
                  {asset.preferenceKey ? <Select className="w-44" aria-label={`Intenção para ${asset.name}`} value={asset.intent} disabled={savingIntent !== null}
                    onChange={(event) => changeIntent(asset.preferenceKey!, event.target.value as AssetIntent)}>
                    <option value="keep">Manter</option><option value="exit">Sair quando possível</option>
                  </Select> : <span className="text-xs text-muted-foreground">Novo investimento</span>}
                  {asset.intent === "exit" && mode === "full" && <label className="mt-2 flex w-44 items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={asset.allowExitSale ?? false} onChange={(event) => updateAsset(asset.key, { allowExitSale: event.target.checked })} className="mt-0.5 accent-accent" />
                    Permitir resgate neste cenário
                  </label>}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-muted-foreground">{asset.future ? "Novo investimento" : formatBRL(asset.originalBalance)}</td>
                <td className="px-3 py-3"><Input aria-label={`Saldo simulado de ${asset.name}`} type="number" inputMode="decimal" min={0} step="0.01" disabled={asset.future} value={asset.balance}
                  onChange={(event) => updateAsset(asset.key, { balance: event.target.value === "" ? 0 : event.target.valueAsNumber })} className={cn("ml-auto h-9 w-40 text-right disabled:bg-muted disabled:text-muted-foreground", asset.balance !== asset.originalBalance && "border-accent")} /></td>
                <td className="px-3 py-3"><Input aria-label={`${dimension === "asset" ? "Meta" : "Peso interno"} de ${asset.name} (%)`} type="number" inputMode="decimal" min={0} max={100} step="0.01" value={asset[shareField]}
                  onChange={(event) => updateAsset(asset.key, { [shareField]: event.target.value === "" ? 0 : event.target.valueAsNumber })} className="ml-auto h-9 w-28 text-right" /></td>
                <td>{asset.future && <Button variant="ghost" size="sm" title={`Remover ${asset.name} da simulação`} aria-label={`Remover ${asset.name} da simulação`} onClick={() => removeFuture(asset.key)}><Trash2 className="h-4 w-4" /></Button>}</td>
              </tr>)}</tbody>
            </table>
            {!filteredAssets.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum ativo encontrado. {assets.length === 0 && "Adicione um ativo futuro para iniciar."}</p>}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">Edite o saldo total da posição para simular valorização ou queda, não a cotação unitária. Ativos futuros começam com saldo zero e são financiados somente por aportes ou resgates. Para zerar uma posição existente, use meta zero no rebalanceamento completo.</p>
        </CardContent>
      </Card>

      {manualMode && mode === "contribution" && <Card>
        <CardHeader title="Seu plano de aporte" subtitle={`Distribuído: ${formatBRL(Object.values(manual).reduce((sum, value) => sum + Math.round(value * 100), 0) / 100)} de ${formatBRL(contribution)}`}
          action={<Button variant="outline" size="sm" onClick={fillSuggestion}>Preencher sugestão por ativo</Button>} />
        <CardContent className="space-y-4">
          <div className="overflow-x-auto"><Tabs tabs={DIMENSIONS} active={manualDimension} onChange={(value) => setManualDimension(value as RebalanceDimension)} /></div>
          <p className="text-xs text-muted-foreground">{manualDimension === "asset" ? "Escolha exatamente quanto aplicar em cada ativo." : "O valor de cada categoria é repartido entre seus ativos pelos pesos internos definidos nas metas correspondentes."} O valor não distribuído permanece em caixa. A sugestão preenche valores individuais.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{manualItems.map((item) => <label key={item.key} className="rounded-lg border border-border p-3 text-xs font-medium">
            <span className="mb-2 block">{item.label}{item.blocked && <span className="mt-1 block font-normal text-destructive">Em saída: aporte deve ser zero</span>}</span>
            <Input aria-label={`Aporte em ${item.label} (R$)`} aria-invalid={item.blocked && (manual[item.key] ?? 0) > 0} type="number" inputMode="decimal" min={0} max={item.blocked ? 0 : undefined} step="0.01" value={manual[item.key] ?? 0}
              onChange={(event) => setManualPlans((current) => ({ ...current, [manualDimension]: { ...current[manualDimension], [item.key]: event.target.value === "" ? 0 : event.target.valueAsNumber } }))} className="text-right tabular-nums" />
          </label>)}</div>
        </CardContent>
      </Card>}
      {(validationError || actionError) && <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{actionError ?? validationError}</div>}
      {result && !savingIntent && !failedIntent && <RebalanceResults result={result} assets={assets} mode={mode} contribution={contribution}
        groupTargets={{ assetClass: classTargets, productType: productTargets }}
        onUseMinimum={(value) => { setContribution(value); setManualMode(false); }} />}
      <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" /><p>Simulação em valores brutos, sem executar ordens ou salvar ativos futuros. Não considera impostos, taxas, liquidez, carências, preços em tempo real ou lotes mínimos. Revise essas condições antes de investir. Trocar a importação, sair da página ou reiniciar descarta o cenário, mas preserva as intenções de manter ou sair salvas na conta.</p></div>
    </>
  );
}

function FutureAssetForm({ assets, classOptions, productOptions, onAdd, onCancel }: {
  assets: RebalanceAsset[];
  classOptions: string[];
  productOptions: string[];
  onAdd: (asset: RebalanceAsset) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [assetClass, setAssetClass] = useState(classOptions[0]);
  const [productType, setProductType] = useState(productOptions[0]);
  const [maturity, setMaturity] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedTicker = ticker.trim().toUpperCase();
    if (!trimmedName) { setError("Informe o nome do ativo."); return; }
    const duplicate = assets.some((asset) => asset.assetClass === assetClass && asset.productType === productType && (asset.maturity ?? "") === maturity &&
      (asset.name.trim().toLocaleLowerCase("pt-BR") === trimmedName.toLocaleLowerCase("pt-BR") || (trimmedTicker && asset.ticker?.toUpperCase() === trimmedTicker)));
    if (duplicate) { setError("Esse ativo já está no cenário. Ajuste a meta ou o aporte da posição existente."); return; }
    onAdd({ key: `future:${crypto.randomUUID()}`, name: trimmedName, ticker: trimmedTicker || undefined, maturity: maturity || undefined,
      assetClass, productType, balance: 0, originalBalance: 0, future: true, targetPct: 0,
      classSharePct: assets.some((asset) => asset.assetClass === assetClass) ? 0 : 100,
      productSharePct: assets.some((asset) => asset.productType === productType) ? 0 : 100 });
  }

  return <form onSubmit={add} className="space-y-4 rounded-xl border border-accent/25 bg-accent/5 p-4">
    <div><h3 className="text-sm font-semibold">Adicionar ativo futuro</h3><p className="mt-1 text-xs text-muted-foreground">Apenas neste cenário. Depois de adicionar, defina a meta ou o aporte. Nenhum valor será incluído no patrimônio inicial.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <label className="space-y-1 text-xs font-medium">Nome do ativo<Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: ETF global ou CDB Banco X" /></label>
      <label className="space-y-1 text-xs font-medium">Ticker (opcional)<Input maxLength={30} value={ticker} onChange={(event) => setTicker(event.target.value)} /></label>
      <label className="space-y-1 text-xs font-medium">Vencimento (opcional)<Input type="date" value={maturity} onChange={(event) => setMaturity(event.target.value)} /></label>
      <label className="space-y-1 text-xs font-medium">Classe<Select aria-label="Classe do ativo futuro" value={assetClass} onChange={(event) => setAssetClass(event.target.value)}>{classOptions.map((key) => <option key={key}>{key}</option>)}</Select></label>
      <label className="space-y-1 text-xs font-medium">Tipo de produto<Select aria-label="Tipo de produto do ativo futuro" value={productType} onChange={(event) => setProductType(event.target.value)}>{productOptions.map((key) => <option key={key}>{key}</option>)}</Select></label>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex gap-2"><Button type="submit" size="sm">Adicionar ao cenário</Button><Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button></div>
  </form>;
}

function RebalanceResults({ result, assets, mode, contribution, groupTargets, onUseMinimum }: {
  result: RebalanceResult;
  assets: RebalanceAsset[];
  mode: RebalanceMode;
  contribution: number;
  groupTargets: { assetClass: Record<string, number>; productType: Record<string, number> };
  onUseMinimum: (value: number) => void;
}) {
  const [view, setView] = useState<RebalanceDimension>("assetClass");
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const activeRows = result.rows.filter((row) => row.currentBRL > 0 || row.targetPct > 0 || row.afterBRL > 0 || byKey.get(row.key)?.future);
  const summary = summarizeRebalance(result, assets, view)
    .filter((row) => row.currentBRL > 0 || row.targetPct > 0 || row.afterBRL > 0 || (view !== "asset" && (groupTargets[view][row.key] ?? 0) > 0))
    .map((row) => view === "asset" || groupTargets[view][row.key] === undefined
      ? row
      : { ...row, targetPct: groupTargets[view][row.key] / 100 });
  const chartData = summary.map((row) => ({ name: row.label,
    Antes: result.totalBefore > 0 ? row.currentBRL / result.totalBefore * 100 : 0,
    Depois: result.totalAfter > 0 ? row.afterBRL / result.totalAfter * 100 : 0, Alvo: row.targetPct * 100 }));
  if (result.remainingCash > 0) chartData.push({ name: "Caixa não alocado", Antes: 0, Depois: result.remainingCash / result.totalAfter * 100, Alvo: 0 });

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Patrimônio do cenário" value={formatBRL(result.totalBefore)} hint="Saldos existentes, antes das operações" icon={<Wallet className="h-4 w-4" />} />
      <StatCard label="Após o rebalanceamento" value={formatBRL(result.totalAfter)} hint={`Inclui ${formatBRL(contribution)} de aporte e o caixa restante`} />
      <StatCard label="Total a aplicar" value={formatBRL(result.purchases)} hint="Compras simuladas por ativo" icon={<ArrowUpRight className="h-4 w-4" />} />
      <StatCard label="Total a resgatar" value={formatBRL(result.sales)} hint={mode === "contribution" ? "Sem vendas neste modo" : "Recursos reutilizados nas compras"} icon={<ArrowDownLeft className="h-4 w-4" />} />
    </div>

    <Card className="overflow-hidden">
      <CardHeader title="Plano de movimentações por ativo" subtitle="O detalhamento inclui posições existentes e ativos futuros. Valores em reais, sem conversão automática em quantidades." />
      <div className="mt-4 max-h-[36rem] overflow-auto">
        <table className="w-full whitespace-nowrap text-sm tabular-nums">
          <caption className="sr-only">Compras, resgates e alocação final de cada ativo</caption>
          <thead className="sticky top-0 z-10 bg-card"><tr className="border-y border-border text-left text-xs text-muted-foreground">
            {['Ativo', 'Antes', 'Alvo', 'Movimentação', 'Depois', 'Desvio final'].map((label, i) => <th key={label} scope="col" className={cn("px-4 py-3 font-medium", i > 0 && "text-right")}>{label}</th>)}
          </tr></thead>
          <tbody>{activeRows.map((row) => <tr key={row.key} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
            <th scope="row" className="px-4 py-3 text-left font-medium"><AssetLabel asset={byKey.get(row.key)!} /></th>
            <td className="px-4 py-3 text-right">{formatBRL(row.currentBRL)}<span className="mt-0.5 block text-xs text-muted-foreground">{formatPct(row.currentPct)}</span></td>
            <td className="px-4 py-3 text-right">{formatBRL(row.targetBRL)}<span className="mt-0.5 block text-xs text-muted-foreground">{formatPct(row.targetPct)}</span></td>
            <td className={cn("px-4 py-3 text-right font-semibold", row.tradeBRL > 0 ? "text-accent" : row.tradeBRL < 0 ? "text-destructive" : "text-muted-foreground")}>{row.tradeBRL === 0 ? byKey.get(row.key)?.intent === "exit" ? "Aguardar saída" : "Manter" : <>{row.tradeBRL > 0 ? "Aplicar" : "Resgatar"}<span className="mt-0.5 block">{formatBRL(Math.abs(row.tradeBRL))}</span></>}</td>
            <td className="px-4 py-3 text-right font-medium">{formatBRL(row.afterBRL)}<span className="mt-0.5 block text-xs text-muted-foreground">{formatPct(row.afterPct)}</span></td>
            <td className={cn("px-4 py-3 text-right", row.afterNeedsAction ? "text-destructive" : "text-muted-foreground")}>{result.totalAfter > 0 ? percentagePoints(row.afterPct - row.targetPct) : "—"}<span className="mt-0.5 block text-[11px]">{row.afterNeedsAction ? "Fora da tolerância" : "Sem alerta"}</span></td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t border-border bg-muted/40 font-semibold"><td className="px-4 py-3">Total {result.remainingCash > 0 && "(inclui caixa)"}</td><td className="px-4 py-3 text-right">{formatBRL(result.totalBefore)}</td><td className="px-4 py-3 text-right">{formatBRL(result.totalAfter)}</td><td className="px-4 py-3 text-right">{formatBRL(contribution - result.remainingCash)}<span className="block text-[11px] font-normal text-muted-foreground">Fluxo líquido alocado</span></td><td className="px-4 py-3 text-right">{formatBRL(result.totalAfter)}</td><td /></tr></tfoot>
        </table>
      </div>
    </Card>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader title="Antes, depois e alvo" subtitle="Agrupa os resultados sem alterar o cenário. O alvo é a meta definida para cada agrupamento (por ativo, a meta efetiva do cenário)." />
        <CardContent className="space-y-4">
          <div className="overflow-x-auto"><Tabs tabs={DIMENSIONS} active={view} onChange={(value) => setView(value as RebalanceDimension)} /></div>
          <div className="max-h-[32rem] overflow-y-auto">
            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 68)}>
              <BarChart data={chartData} layout="vertical" margin={{ right: 12 }} barGap={3} accessibilityLayer>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke={CHART.grid} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: "var(--foreground)" }} stroke={CHART.grid} />
                <Tooltip formatter={(value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Antes" fill={CHART.planned} radius={[0, 3, 3, 0]} barSize={12} isAnimationActive={false} />
                <Bar dataKey="Depois" fill={CHART.current} radius={[0, 3, 3, 0]} barSize={12} isAnimationActive={false} />
                <Bar dataKey="Alvo" fill="var(--muted-foreground)" radius={[0, 3, 3, 0]} barSize={12} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {view !== "asset" && <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-xs tabular-nums">
            <caption className="sr-only">Movimentações consolidadas, sem compensar compras e resgates entre ativos</caption>
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 font-medium">Categoria</th><th className="px-3 py-2 text-right font-medium">Aplicar</th><th className="px-3 py-2 text-right font-medium">Resgatar</th><th className="py-2 text-right font-medium">Saldo final</th></tr></thead>
            <tbody>{summary.map((row) => <tr key={row.key} className="border-b border-border/50"><th scope="row" className="py-2 text-left font-medium">{row.label}</th><td className="px-3 py-2 text-right text-accent">{formatBRL(row.purchases)}</td><td className="px-3 py-2 text-right text-destructive">{formatBRL(row.sales)}</td><td className="py-2 text-right">{formatBRL(row.afterBRL)}</td></tr>)}</tbody>
          </table></div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Leitura do cenário" subtitle="Indicadores calculados ativo por ativo" />
        <CardContent className="space-y-5">
          {assets.some((asset) => asset.intent === "exit") && <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">{assets.filter((asset) => asset.intent === "exit").length} posições em saída, sem novos aportes.</strong>
            {" "}A meta final dessas posições é zero. Sem liberação de resgate, o saldo continua na carteira e o desvio permanece visível. No modo aporte, não há vendas, mesmo com resgate liberado.
          </div>}
          <div>
            <p className="text-xs text-muted-foreground">Distância do alvo</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold tabular-nums"><span className="text-muted-foreground">{percentagePoints(result.distanceBefore)}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /><span className={result.distanceAfter > result.distanceBefore + 0.000001 ? "text-destructive" : "text-accent"}>{percentagePoints(result.distanceAfter)}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">Metade da soma dos desvios absolutos por ativo, incluindo caixa. Quanto menor, mais próximo do alvo.</p>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold">{result.rows.filter((row) => row.needsAction).length} → {result.rows.filter((row) => row.afterNeedsAction).length} ativos fora da tolerância</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Alerta quando o desvio relativo supera 20% do alvo e a diferença supera 0,25% do patrimônio (mínimo de R$ 1).</p>
          </div>
          {result.remainingCash > 0 && <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm"><span className="font-semibold">{formatBRL(result.remainingCash)} ainda em caixa</span><p className="mt-1 text-xs text-muted-foreground">Incluído no total final, mas não alocado em ativos.</p></div>}
          {mode === "contribution" && <div className="rounded-lg bg-accent/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-accent" /> Para atingir o alvo sem vender</p>
            {result.minimumContribution === null ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Há saldo em um ativo com meta zero. Nenhum aporte finito elimina essa posição: revise a meta ou simule o rebalanceamento completo.</p> : <>
              <p className="mt-2 text-xl font-bold text-accent">{formatBRL(result.minimumContribution)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Aporte total mínimo para as metas individuais, incluindo os pesos internos. Não é um valor adicional ao que você digitou.</p>
              {result.minimumContribution > contribution && <Button className="mt-3" variant="outline" size="sm" onClick={() => onUseMinimum(result.minimumContribution!)}>Simular esse aporte <ArrowRight className="h-3.5 w-3.5" /></Button>}
            </>}
          </div>}
          {result.totalAfter === 0 && <p className="text-xs text-muted-foreground">Sem patrimônio ou aporte para distribuir. Informe um valor para iniciar a simulação.</p>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
