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
import { allocationNeedsAction, REBALANCE_TOLERANCE, RESIDUAL_TOLERANCE } from "../lib/allocation";
import { formatBRL, formatDate, formatDateISO, formatPct } from "../lib/format";
import {
  applyExitShares, assetTargetCategories, createRebalanceAssets, rebalancePreferenceKey, simulateAssetRebalance, summarizeMetrics, summarizeRebalance, validAllocation,
  type RebalanceAsset, type RebalanceDimension, type RebalanceMode, type RebalanceResult, type RebalanceRow,
} from "../lib/rebalance";
import { ASSET_CLASSES, PRODUCT_TYPES, type AssetIntent, type Position, type RebalancePreference, type RebalanceSharePatch, type Targets } from "../lib/types";
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

function pctPlaceholder(fraction: number | undefined): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return "";
  return (fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function AssetLabel({ asset }: { asset: RebalanceAsset }) {
  return (
    <div className="min-w-44">
      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(asset.assetClass) }} />
      {asset.name}
      {asset.future && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">Futuro</span>}
      {asset.intent === "exit" && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">Em saída</span>}
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
  const { preferences, loading: loadingPreferences, error: preferencesError, saveIntent, saveShares } = useRebalancePreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const dimension = searchParams.get("visao") === "produtos" ? "productType" : "assetClass";
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
            onSaveShares={saveShares}
            dimension={dimension}
            onDimensionChange={(value) => setSearchParams(value === "productType" ? { visao: "produtos" } : {}, { replace: true })}
          />
        </>
      )}
    </div>
  );
}

function RebalanceScenario({ positions, dimension, savedTargets, preferences, onSaveIntent, onSaveShares, onDimensionChange }: {
  positions: Position[];
  dimension: "assetClass" | "productType";
  savedTargets: Targets;
  preferences: Record<string, RebalancePreference>;
  onSaveIntent: (key: string, intent: AssetIntent) => Promise<void>;
  onSaveShares: (updates: Record<string, RebalanceSharePatch>) => Promise<void>;
  onDimensionChange: (dimension: "assetClass" | "productType") => void;
}) {
  const [assetDraft, setAssets] = useState(() => createRebalanceAssets(positions, savedTargets.byAssetClass));
  const [shareDraft, setShareDraft] = useState<Record<string, RebalanceSharePatch>>({});
  const [savingShares, setSavingShares] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const assets = useMemo(() => applyExitShares(assetDraft.map((asset): RebalanceAsset => {
    const pref = asset.preferenceKey ? preferences[asset.preferenceKey] : undefined;
    const draft = asset.preferenceKey ? shareDraft[asset.preferenceKey] : undefined;
    return { ...asset, intent: pref?.intent ?? "keep",
      classSharePct: draft?.classSharePct !== undefined ? draft.classSharePct ?? asset.classSharePct : pref?.classSharePct ?? asset.classSharePct,
      productSharePct: draft?.productSharePct !== undefined ? draft.productSharePct ?? asset.productSharePct : pref?.productSharePct ?? asset.productSharePct,
    };
  })), [assetDraft, preferences, shareDraft]);
  const [savingIntent, setSavingIntent] = useState<string | null>(null);
  const [failedIntent, setFailedIntent] = useState<{ key: string; intent: AssetIntent; message: string } | null>(null);
  const classTargets = savedTargets.byAssetClass;
  const productTargets = savedTargets.byProductType;
  const [mode, setMode] = useState<RebalanceMode>("contribution");
  const [contribution, setContribution] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const targets = dimension === "productType" ? productTargets : classTargets;
  const classOptions = [...new Set([...ASSET_CLASSES, ...assets.map((asset) => asset.assetClass), ...Object.keys(classTargets)])];
  const productOptions = [...new Set([...PRODUCT_TYPES, ...assets.map((asset) => asset.productType), ...Object.keys(productTargets)])];
  const groupKeys = dimension === "assetClass" ? classOptions : productOptions;
  const shareField = dimension === "productType" ? "productSharePct" : "classSharePct";
  const targetSum = Object.values(targets).reduce((sum, value) => sum + value, 0);
  const dirtyShares = Object.keys(shareDraft).length > 0;
  const invalidShares = (["assetClass", "productType"] as const).some((groupField) => {
    const field = groupField === "assetClass" ? "classSharePct" : "productSharePct";
    const changedGroups = new Set(assets.filter((asset) => asset.preferenceKey && shareDraft[asset.preferenceKey]?.[field] !== undefined).map((asset) => asset[groupField]));
    return [...changedGroups].some((key) => {
      const members = assets.filter((asset) => asset[groupField] === key);
      return members.some((asset) => asset.intent !== "exit") && !validAllocation(members.map((asset) => asset[field]));
    });
  });
  const manualTotal = Object.values(manual).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const classRank = new Map<string, number>(ASSET_CLASSES.map((key, index) => [key, index]));
  const filteredAssets = assets
    .filter((asset) => `${asset.name} ${asset.ticker ?? ""} ${asset.assetClass} ${asset.productType}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")))
    .sort((a, b) => (classRank.get(a.assetClass) ?? ASSET_CLASSES.length) - (classRank.get(b.assetClass) ?? ASSET_CLASSES.length)
      || a.assetClass.localeCompare(b.assetClass, "pt-BR")
      || a.productType.localeCompare(b.productType, "pt-BR")
      || a.name.localeCompare(b.name, "pt-BR"));

  // Meta sugerida de cada ativo, sem os overrides manuais — usada como placeholder da coluna Meta.
  const suggestedTargets = useMemo(() => {
    try {
      const categories = assetTargetCategories(
        assets.map((asset) => ({ ...asset, targetOverridePct: undefined })), dimension, targets);
      return new Map(categories.map((category) => [category.key, category.targetPct]));
    } catch {
      return new Map<string, number>();
    }
  }, [assets, dimension, targets]);

  const { result, validationError } = useMemo(() => {
    try {
      return {
        result: simulateAssetRebalance({ assets, dimension, targets,
          contribution: mode === "contribution" ? contribution : 0,
          withdrawal: mode === "withdrawal" ? contribution : 0, mode, manualDimension: "asset",
          manualContributions: manualMode && mode === "contribution" ? manual : undefined }),
        validationError: null,
      };
    } catch (error) {
      return { result: null, validationError: error instanceof Error ? error.message : "Revise os valores do cenário." };
    }
  }, [assets, dimension, targets, contribution, mode, manualMode, manual]);

  const rowByKey = useMemo(() => new Map(result?.rows.map((row) => [row.key, row]) ?? []), [result]);
  const groupPlan = useMemo(() => new Map(result ? summarizeRebalance(result, assets, dimension).map((row) => [row.key, row]) : []), [result, assets, dimension]);
  const totalBalance = assets.reduce((sum, asset) => sum + asset.balance, 0);

  async function changeIntent(key: string, intent: AssetIntent) {
    setSavingIntent(key);
    setFailedIntent(null);
    try {
      await onSaveIntent(key, intent);
      setAssets((current) => current.map((asset) => asset.preferenceKey === key ? { ...asset, allowExitSale: false } : asset));
      if (intent === "exit") {
        const blockedKeys = new Set(assets.filter((asset) => asset.preferenceKey === key).map((asset) => asset.key));
        setManual((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !blockedKeys.has(id))));
      }
      toast.success(intent === "exit" ? "Intenção salva: este ativo não receberá novos aportes." : "Intenção salva: ativo disponível para novos aportes.");
    } catch (error) {
      setFailedIntent({ key, intent, message: error instanceof Error ? error.message : "Não foi possível salvar a intenção." });
    } finally {
      setSavingIntent(null);
    }
  }

  function updateAsset(key: string, patch: Partial<RebalanceAsset>) {
    if (patch[shareField] !== undefined) {
      const edited = assets.find((asset) => asset.key === key);
      if (!edited || edited.intent === "exit") return;
      setShareDraft((current) => {
        const next = { ...current };
        for (const asset of assets.filter((asset) => asset[dimension] === edited[dimension])) {
          if (asset.preferenceKey) next[asset.preferenceKey] = { ...next[asset.preferenceKey], [shareField]: asset.key === key ? patch[shareField] : asset[shareField] };
        }
        return next;
      });
      setShareMessage(null);
      setShareError(null);
    } else {
      setAssets((current) => current.map((asset) => asset.key === key ? { ...asset, ...patch } : asset));
    }
    setActionError(null);
  }

  /** Peso sugerido pela proporção do saldo importado dentro da categoria. */
  function defaultShare(asset: RebalanceAsset, field: "classSharePct" | "productSharePct"): number {
    return assetDraft.find((item) => item.key === asset.key)?.[field] ?? 0;
  }

  async function saveDistribution() {
    if (!dirtyShares || savingShares || savingIntent || invalidShares) return;
    setSavingShares(true);
    setShareMessage(null);
    setShareError(null);
    try {
      await onSaveShares(shareDraft);
      setShareDraft({});
      setShareMessage("Distribuição salva na sua conta. Será usada nas próximas sugestões.");
      toast.success("Distribuição salva");
    } catch (error) {
      setShareError(`Não foi possível salvar a distribuição. Suas alterações foram mantidas para tentar novamente. ${error instanceof Error ? error.message : ""}`);
    } finally {
      setSavingShares(false);
    }
  }

  function resetShares() {
    setShareDraft((current) => {
      const next = { ...current };
      for (const asset of assets) {
        if (asset.preferenceKey) next[asset.preferenceKey] = { ...next[asset.preferenceKey], [shareField]: null };
      }
      return next;
    });
    setShareMessage(null);
    setShareError(null);
  }

  function removeFuture(key: string) {
    const remaining = assetDraft.filter((asset) => asset.key !== key || !asset.future);
    const removed = assetDraft.find((asset) => asset.key === key && asset.future);
    setAssets(remaining);
    if (removed?.preferenceKey) setShareDraft((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== removed.preferenceKey)));
    setManual((current) => Object.fromEntries(Object.entries(current).filter(([id]) => remaining.some((asset) => asset.key === id))));
    setActionError(null);
  }

  function fillSuggestion() {
    try {
      const suggestion = simulateAssetRebalance({ assets, dimension, targets, contribution, mode: "contribution" });
      setManual(Object.fromEntries(suggestion.rows.map((row) => [row.key, row.tradeBRL])));
      setManualMode(true);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível gerar a sugestão.");
    }
  }

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold">Modo de rebalanceamento</p>
            <Tabs
              tabs={[
                { id: "contribution", label: "Só novo aporte" },
                { id: "withdrawal", label: "Só resgate" },
              ]}
              active={mode}
              onChange={(value) => { setMode(value as RebalanceMode); setActionError(null); }}
            />
          </div>
          <div>
            <label htmlFor="rebalance-contribution" className="mb-2 block text-sm font-semibold">
              {mode === "withdrawal" ? "Quanto você quer resgatar?" : "Quanto você quer aportar?"}
            </label>
            <div className="relative w-52">
              <span className="absolute left-3 top-3 text-sm text-muted-foreground">R$</span>
              <Input id="rebalance-contribution" type="number" inputMode="decimal" min={0} step="0.01" value={contribution}
                onChange={(event) => setContribution(event.target.value === "" ? 0 : event.target.valueAsNumber)} className="h-10 pl-10 font-semibold tabular-nums" />
            </div>
          </div>
          {mode === "contribution" && (
            <div>
              <p className="mb-2 text-sm font-semibold">Distribuição do aporte</p>
              <div className="flex items-center gap-2">
                <Tabs
                  tabs={[
                    { id: "suggested", label: "Sugerida" },
                    { id: "manual", label: "Valores manuais" },
                  ]}
                  active={manualMode ? "manual" : "suggested"}
                  onChange={(value) => setManualMode(value === "manual")}
                />
                <Button variant="outline" size="sm" onClick={fillSuggestion}>{manualMode ? "Preencher com a sugestão" : "Editar a partir da sugestão"}</Button>
              </div>
            </div>
          )}
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {mode === "contribution"
              ? `Prioriza classes com desvio abaixo da meta maior que ${pctPlaceholder(REBALANCE_TOLERANCE)}% e diferença maior que ${pctPlaceholder(RESIDUAL_TOLERANCE)}% do patrimônio (mínimo de R$ 1). Reduz os maiores gaps da carteira; a sobra cobre déficits menores. Dentro da classe, completa um ativo por vez.`
              : `Resgata primeiro das classes com excesso acima da meta maior que ${pctPlaceholder(REBALANCE_TOLERANCE)}% e diferença maior que ${pctPlaceholder(RESIDUAL_TOLERANCE)}% do patrimônio (mínimo de R$ 1). Dentro da classe, vende o ativo mais acima do alvo; ativos em saída exigem "Permitir resgate". Nenhuma compra é sugerida.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Metas da Carteira Ideal" subtitle="As metas de classe e produto vêm da Carteira Ideal. Na tabela, edite apenas a participação de cada ativo dentro da sua classe ou produto, não na carteira inteira."
          action={<span className={cn("rounded-full px-3 py-1 text-xs font-semibold", Math.abs(targetSum - 100) <= 0.05 ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive")}>
            Soma das categorias: {Number.isFinite(targetSum) ? `${targetSum.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "inválida"}
          </span>} />
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="overflow-x-auto"><Tabs tabs={DIMENSIONS.filter((tab) => tab.id !== "asset")} active={dimension} onChange={(value) => { onDimensionChange(value as "assetClass" | "productType"); setActionError(null); }} /></div>
            <Link to="/carteira-ideal" className="text-xs font-medium text-accent hover:underline">Editar metas na Carteira Ideal</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {groupKeys.filter((key) => assets.some((asset) => asset[dimension] === key) || (targets[key] ?? 0) > 0).map((key) => {
              const members = assets.filter((asset) => asset[dimension] === key);
              const sum = members.reduce((acc, asset) => acc + asset[shareField], 0);
              const valid = validAllocation(members.map((asset) => asset[shareField]));
              const balance = members.reduce((acc, asset) => acc + asset.balance, 0);
              const weight = (targets[key] ?? 0) / 100;
              const below = balance < totalBalance * weight;
              const priority = below && allocationNeedsAction(balance, totalBalance, weight);
              const excessPriority = !below && allocationNeedsAction(balance, totalBalance, weight);
              return <div key={key} className="rounded-lg border border-border px-3 py-2 text-xs">
                <p className="font-medium">{key} · Meta na carteira: {formatPct(weight)}</p>
                {mode === "contribution" && <p className={cn("mt-1", priority ? "font-medium text-accent" : "text-muted-foreground")}>
                  {priority ? "Déficit significativo · prioridade" : below ? "Déficit dentro da tolerância · recebe sobra" : "Sem déficit antes do aporte"}
                  {result && !savingIntent && !failedIntent && ` · ${formatBRL(groupPlan.get(key)?.purchases ?? 0)} no plano`}
                </p>}
                {mode === "withdrawal" && <p className={cn("mt-1", excessPriority ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {excessPriority ? "Excesso significativo · prioridade de resgate" : !below ? "Excesso dentro da tolerância" : "Sem excesso antes do resgate"}
                  {result && !savingIntent && !failedIntent && ` · ${formatBRL(groupPlan.get(key)?.sales ?? 0)} resgatado`}
                </p>}
                <p className={cn("mt-1", valid ? "text-muted-foreground" : "text-destructive")}>
                  {members.length} ativos · Distribuição interna: {formatPct(sum / 100)} / 100%
                  {!members.length ? " · adicione um ativo" : members.every((asset) => asset.intent === "exit") ? " · sem ativo para receber aportes" : !valid ? " · ajuste para somar 100%" : ""}
                </p>
              </div>;
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Cenário e plano"
          subtitle={manualMode && mode === "contribution"
            ? `Aporte manual distribuído: ${formatBRL(manualTotal)} de ${formatBRL(contribution)} — o restante fica em caixa.`
            : `${assets.filter((asset) => !asset.future).length} posições · ${assets.filter((asset) => asset.future).length} ativos futuros · Manter ou sair é salvo na conta.`}
          action={<div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={savingShares} onClick={resetShares}>Restaurar sugestão</Button>
            <Button size="sm" disabled={!dirtyShares || savingShares || savingIntent !== null || invalidShares} onClick={saveDistribution}>{savingShares ? "Salvando distribuição…" : "Salvar distribuição"}</Button>
            <Button size="sm" variant="outline" disabled={savingShares} aria-expanded={showAddAsset} onClick={() => setShowAddAsset((value) => !value)}><Plus className="h-4 w-4" /> Adicionar ativo</Button>
          </div>} />
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Cada classe tem sua própria distribuição de 100%. A sugestão inicial usa os saldos importados; edite os percentuais e clique em Salvar distribuição para usá-los nas próximas visitas.</p>
          {dirtyShares && <p role="status" className="text-xs text-accent">Alterações não salvas. A simulação usa os valores em edição.{invalidShares && " Ajuste a distribuição de cada classe ou produto alterado para somar 100% antes de salvar."}</p>}
          {shareMessage && <p role="status" className="text-xs text-accent">{shareMessage}</p>}
          {shareError && <p role="alert" className="text-sm text-destructive">{shareError}</p>}
          {savingIntent && <p role="status" className="text-xs text-muted-foreground">Salvando intenção na sua conta. As sugestões ficam suspensas até a confirmação.</p>}
          {failedIntent && <div role="alert" className="rounded-lg border border-destructive/25 p-3 text-sm text-destructive">
            Não foi possível salvar a intenção. As sugestões estão suspensas: {failedIntent.message}
            <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => changeIntent(failedIntent.key, failedIntent.intent)}>Tentar novamente</Button><Button size="sm" variant="ghost" onClick={() => setFailedIntent(null)}>Descartar alteração</Button></div>
          </div>}
          {showAddAsset && <FutureAssetForm classOptions={classOptions} productOptions={productOptions} assets={assets}
            onCancel={() => setShowAddAsset(false)} onAdd={(asset) => { setAssets((current) => [...current, asset]); setShowAddAsset(false); setSearch(""); setActionError(null); }} />}
          <Input type="search" aria-label="Buscar ativos do cenário" placeholder="Buscar ativo, ticker, classe ou produto" value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-md" />
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Cenário e plano de rebalanceamento por ativo</caption>
              <thead className="sticky top-0 z-10 bg-card"><tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-3 pr-4 font-medium">Ativo</th>
                <th scope="col" className="px-3 py-3 font-medium">Intenção</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Saldo (R$)</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Meta dentro {dimension === "assetClass" ? "da classe" : "do produto"} (%)<span className="block text-[10px] font-normal">100% em cada {dimension === "assetClass" ? "classe" : "produto"}</span></th>
                <th scope="col" className="px-3 py-3 text-right font-medium">{manualMode && mode === "contribution" ? "Aporte (R$)" : "Plano"}</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Depois</th>
                <th scope="col"><span className="sr-only">Remover ativo futuro</span></th>
              </tr></thead>
              <tbody>{filteredAssets.map((asset) => {
                const row = rowByKey.get(asset.key);
                return <ScenarioRow
                  key={asset.key}
                  asset={asset}
                  row={row}
                  dimension={dimension}
                  shareField={shareField}
                  mode={mode}
                  manualMode={manualMode}
                  manualValue={manual[asset.key]}
                  suggestedPct={(targets[asset[dimension]] ?? 0) > 0 ? (suggestedTargets.get(asset.key) ?? 0) / targets[asset[dimension]] * 100 : defaultShare(asset, shareField)}
                  saving={savingIntent !== null || savingShares}
                  shareDirty={!!(asset.preferenceKey && shareDraft[asset.preferenceKey]?.[shareField] !== undefined)}
                  shareSaved={!!(asset.preferenceKey && preferences[asset.preferenceKey]?.[shareField] !== undefined)}
                  totalAfter={result?.totalAfter ?? 0}
                  onIntent={changeIntent}
                  onUpdate={updateAsset}
                  onManual={(value) => setManual((current) => ({ ...current, [asset.key]: value }))}
                  onRemove={removeFuture}
                />;
              })}</tbody>
            </table>
            {!filteredAssets.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum ativo encontrado. {assets.length === 0 && "Adicione um ativo futuro para iniciar."}</p>}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">Edite o saldo para simular valorização ou queda. Ativos em saída têm meta zero e nunca recebem aportes — no modo só resgate, marque “Permitir resgate” para simular a venda.</p>
        </CardContent>
      </Card>

      {(validationError || actionError) && <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{actionError ?? validationError}</div>}
      {result && !savingIntent && !failedIntent && <RebalanceResults result={result} assets={assets} mode={mode} contribution={contribution}
        groupTargets={{ assetClass: classTargets, productType: productTargets }}
        onUseMinimum={(value) => { setContribution(value); setManualMode(false); }} />}
      <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" /><p>Simulação em valores brutos, sem executar ordens ou salvar ativos futuros. Não considera impostos, taxas, liquidez, carências, preços em tempo real ou lotes mínimos. Revise essas condições antes de investir. Trocar a importação, sair da página ou reiniciar descarta o cenário, mas preserva as intenções e distribuições salvas na conta.</p></div>
    </>
  );
}

function ScenarioRow({ asset, row, dimension, shareField, mode, manualMode, manualValue, suggestedPct, saving, totalAfter, shareSaved, shareDirty, onIntent, onUpdate, onManual, onRemove }: {
  asset: RebalanceAsset;
  row?: RebalanceRow;
  dimension: RebalanceDimension;
  shareField: "classSharePct" | "productSharePct";
  mode: RebalanceMode;
  manualMode: boolean;
  manualValue?: number;
  suggestedPct?: number;
  saving: boolean;
  totalAfter: number;
  onIntent: (key: string, intent: AssetIntent) => void;
  onUpdate: (key: string, patch: Partial<RebalanceAsset>) => void;
  onManual: (value: number) => void;
  onRemove: (key: string) => void;
  shareSaved: boolean;
  shareDirty: boolean;
}) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-medium"><AssetLabel asset={asset} /></th>
      <td className="px-3 py-3 align-top">
        {asset.preferenceKey ? <Select className="w-40" aria-label={`Intenção para ${asset.name}`} value={asset.intent} disabled={saving}
          onChange={(event) => onIntent(asset.preferenceKey!, event.target.value as AssetIntent)}>
          <option value="keep">Manter</option><option value="exit">Sair quando possível</option>
        </Select> : <span className="text-xs text-muted-foreground">Novo investimento</span>}
        {asset.intent === "exit" && mode === "withdrawal" && <label className="mt-2 flex w-40 items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={asset.allowExitSale ?? false} onChange={(event) => onUpdate(asset.key, { allowExitSale: event.target.checked })} className="mt-0.5 accent-accent" />
          Permitir resgate
        </label>}
      </td>
      <td className="px-3 py-3 align-top">
        <Input aria-label={`Saldo simulado de ${asset.name}`} type="number" inputMode="decimal" min={0} step="0.01" disabled={asset.future} value={asset.balance}
          onChange={(event) => onUpdate(asset.key, { balance: event.target.value === "" ? 0 : event.target.valueAsNumber })}
          className={cn("ml-auto h-9 w-36 text-right disabled:bg-muted disabled:text-muted-foreground", asset.balance !== asset.originalBalance && "border-accent")} />
        {!asset.future && row && <span className="mt-1 block text-right text-[11px] text-muted-foreground">{formatPct(row.currentPct)}</span>}
        {asset.balance !== asset.originalBalance && !asset.future && <span className="mt-0.5 block text-right text-[11px] text-muted-foreground">importado: {formatBRL(asset.originalBalance)}</span>}
      </td>
      <td className="px-3 py-3 align-top">
        <Input aria-label={`Meta de ${asset.name} dentro ${dimension === "productType" ? "do produto" : "da classe"} (%)`}
          aria-invalid={!Number.isFinite(asset[shareField]) || asset[shareField] < 0 || asset[shareField] > 100}
          type="number" inputMode="decimal" min={0} max={100} step="0.01" disabled={saving || asset.intent === "exit"}
          value={Number.isFinite(asset[shareField]) ? asset[shareField] : ""} placeholder={pctPlaceholder(suggestedPct !== undefined ? suggestedPct / 100 : undefined)}
          onChange={(event) => onUpdate(asset.key, { [shareField]: event.target.value === "" ? 0 : event.target.valueAsNumber })}
          title="Percentual dentro desta classe ou produto, não da carteira. Edite e clique em Salvar distribuição."
          className={cn("ml-auto h-9 w-24 text-right", (shareSaved || shareDirty) && "border-accent")} />
        <span className="mt-1 block text-right text-[11px] text-muted-foreground">{asset.intent === "exit" ? "Zerada pela intenção de saída" : shareDirty ? "Não salvo" : shareSaved ? "Salvo na conta" : "Sugerido pelo saldo"}</span>
        {asset.intent === "exit" && <span className="mt-1 block text-right text-[11px] text-muted-foreground">Meta efetiva: 0% · sem novos aportes</span>}
      </td>
      <td className="px-3 py-3 text-right align-top">
        {manualMode && mode === "contribution"
          ? <Input aria-label={`Aporte em ${asset.name} (R$)`} aria-invalid={asset.intent === "exit" && (manualValue ?? 0) > 0}
              type="number" inputMode="decimal" min={0} step="0.01" disabled={asset.intent === "exit"} value={manualValue ?? ""} placeholder="0"
              onChange={(event) => onManual(event.target.value === "" ? 0 : event.target.valueAsNumber)} className="ml-auto h-9 w-32 text-right disabled:bg-muted" />
          : <TradeCell row={row} exit={asset.intent === "exit"} />}
      </td>
      <td className="px-3 py-3 text-right align-top">
        {row ? <>
          <span className="font-medium">{formatBRL(row.afterBRL)}</span>
          <span className={cn("mt-1 block text-[11px]", row.afterNeedsAction ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {totalAfter > 0 ? formatPct(row.afterPct) : "—"}{row.afterNeedsAction && " · fora da tolerância"}
          </span>
        </> : "—"}
      </td>
      <td className="align-top">{asset.future && <Button variant="ghost" size="sm" title={`Remover ${asset.name} da simulação`} aria-label={`Remover ${asset.name} da simulação`} disabled={saving} onClick={() => onRemove(asset.key)}><Trash2 className="h-4 w-4" /></Button>}</td>
    </tr>
  );
}

function TradeCell({ row, exit }: { row?: RebalanceRow; exit: boolean }) {
  if (!row) return <span className="text-muted-foreground">—</span>;
  if (row.tradeBRL === 0) return <span className="text-muted-foreground">{exit ? "Aguardar saída" : "Manter"}</span>;
  return (
    <span className={cn("font-semibold", row.tradeBRL > 0 ? "text-accent" : "text-destructive")}>
      {row.tradeBRL > 0 ? "Aplicar" : "Resgatar"}
      <span className="block">{formatBRL(Math.abs(row.tradeBRL))}</span>
    </span>
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
      preferenceKey: rebalancePreferenceKey({ name: trimmedName, ticker: trimmedTicker || undefined, maturity: maturity || undefined }),
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
  const summary = summarizeRebalance(result, assets, view)
    .filter((row) => row.currentBRL > 0 || row.targetPct > 0 || row.afterBRL > 0 || (view !== "asset" && (groupTargets[view][row.key] ?? 0) > 0))
    .map((row) => view === "asset" || groupTargets[view][row.key] === undefined
      ? row
      : { ...row, targetPct: groupTargets[view][row.key] / 100 });
  const metrics = summarizeMetrics(result, assets, view, view === "asset" ? undefined : groupTargets[view]);
  const groupLabel = view === "asset" ? "ativo" : view === "assetClass" ? "classe" : "produto";
  const chartData = summary.map((row) => ({ name: row.label,
    Antes: result.totalBefore > 0 ? row.currentBRL / result.totalBefore * 100 : 0,
    Depois: result.totalAfter > 0 ? row.afterBRL / result.totalAfter * 100 : 0, Alvo: row.targetPct * 100 }));
  if (result.remainingCash > 0) chartData.push({ name: "Caixa não alocado", Antes: 0, Depois: result.remainingCash / result.totalAfter * 100, Alvo: 0 });

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Patrimônio do cenário" value={formatBRL(result.totalBefore)} hint="Saldos existentes, antes das operações" icon={<Wallet className="h-4 w-4" />} />
      <StatCard label="Após o rebalanceamento" value={formatBRL(result.totalAfter)} hint={mode === "withdrawal" ? `Depois de resgatar ${formatBRL(contribution)}` : `Inclui ${formatBRL(contribution)} de aporte e o caixa restante`} />
      <StatCard label="Total a aplicar" value={formatBRL(result.purchases)} hint={mode === "withdrawal" ? "Nenhuma compra neste modo" : "Compras simuladas por ativo"} icon={<ArrowUpRight className="h-4 w-4" />} />
      <StatCard label="Total a resgatar" value={formatBRL(result.sales)} hint={mode === "contribution" ? "Sem vendas neste modo" : "Valor retirado da carteira"} icon={<ArrowDownLeft className="h-4 w-4" />} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader title="Antes, depois e alvo" subtitle="Agrupa os resultados sem alterar o cenário." />
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
        <CardHeader title="Leitura do cenário" subtitle="Indicadores no mesmo agrupamento do gráfico ao lado" />
        <CardContent className="space-y-5">
          {assets.some((asset) => asset.intent === "exit") && <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">{assets.filter((asset) => asset.intent === "exit").length} posições em saída, sem novos aportes.</strong>
            {" "}Sem liberação de resgate, o saldo continua na carteira e o desvio permanece visível.
          </div>}
          <div>
            <p className="text-xs text-muted-foreground">Distância do alvo</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold tabular-nums"><span className="text-muted-foreground">{percentagePoints(metrics.distanceBefore)}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /><span className={metrics.distanceAfter > metrics.distanceBefore + 0.000001 ? "text-destructive" : "text-accent"}>{percentagePoints(metrics.distanceAfter)}</span></p>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold">{metrics.before} → {metrics.after} {view === "asset" ? "ativos" : "categorias"} fora da tolerância</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Alerta por {groupLabel} quando o desvio relativo supera 20% do alvo e a diferença supera 0,25% do patrimônio.</p>
          </div>
          {result.remainingCash > 0 && <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm"><span className="font-semibold">{formatBRL(result.remainingCash)} ainda em caixa</span><p className="mt-1 text-xs text-muted-foreground">Incluído no total final, mas não alocado em ativos.</p></div>}
          {mode === "contribution" && <div className="rounded-lg bg-accent/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-accent" /> Para atingir o alvo sem vender</p>
            {result.minimumContribution === null ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Há saldo em um ativo com meta zero. Nenhum aporte finito elimina essa posição: revise a meta ou simule o rebalanceamento completo.</p> : <>
              <p className="mt-2 text-xl font-bold text-accent">{formatBRL(result.minimumContribution)}</p>
              {result.minimumContribution > contribution && <Button className="mt-3" variant="outline" size="sm" onClick={() => onUseMinimum(result.minimumContribution!)}>Simular esse aporte <ArrowRight className="h-3.5 w-3.5" /></Button>}
            </>}
          </div>}
          {result.totalAfter === 0 && <p className="text-xs text-muted-foreground">Sem patrimônio ou aporte para distribuir. Informe um valor para iniciar a simulação.</p>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
