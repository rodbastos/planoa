import { REBALANCE_TOLERANCE, RESIDUAL_TOLERANCE } from "./allocation";
import { instrumentKey } from "./classification";
import type { AssetIntent, Position } from "./types";

export type RebalanceMode = "contribution" | "full";
export type RebalanceDimension = "asset" | "assetClass" | "productType";

export interface RebalanceAsset {
  key: string;
  name: string;
  ticker?: string;
  maturity?: string;
  assetClass: string;
  productType: string;
  originalBalance: number;
  balance: number;
  future: boolean;
  preferenceKey?: string;
  intent?: AssetIntent;
  allowExitSale?: boolean;
  targetPct: number;
  /** meta manual (% da carteira): quando definida, substitui a meta sugerida do ativo */
  targetOverridePct?: number;
  classSharePct: number;
  productSharePct: number;
}

export interface AssetRebalanceInput {
  assets: RebalanceAsset[];
  dimension: RebalanceDimension;
  targets: Record<string, number>;
  contribution: number;
  mode: RebalanceMode;
  manualContributions?: Record<string, number>;
  manualDimension?: RebalanceDimension;
}

export function validAllocation(values: number[]): boolean {
  return values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100) &&
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) <= 0.05;
}

export interface RebalanceCategory {
  key: string;
  balance: number;
  targetPct: number;
}

export interface RebalanceInput {
  categories: RebalanceCategory[];
  contribution: number;
  mode: RebalanceMode;
  manualContributions?: Record<string, number>;
}

export interface RebalanceRow {
  key: string;
  currentBRL: number;
  currentPct: number;
  targetPct: number;
  targetBRL: number;
  tradeBRL: number;
  afterBRL: number;
  afterPct: number;
  needsAction: boolean;
  afterNeedsAction: boolean;
}

export interface RebalanceResult {
  rows: RebalanceRow[];
  totalBefore: number;
  totalAfter: number;
  purchases: number;
  sales: number;
  remainingCash: number;
  minimumContribution: number | null;
  distanceBefore: number;
  distanceAfter: number;
}

function toCents(value: number): number {
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents)) {
    throw new Error("Informe valores monetários válidos, não negativos e dentro do limite de precisão.");
  }
  return cents;
}

function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight / sum) * total);
  const amounts = exact.map(Math.floor);
  const remainder = total - amounts.reduce((acc, value) => acc + value, 0);
  const ranked = exact.map((value, index) => ({ index, fraction: value - amounts[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) amounts[ranked[i].index]++;
  return amounts;
}

function needsAction(balance: number, total: number, weight: number): boolean {
  const target = total * weight;
  const difference = Math.abs(balance - target);
  return difference > Math.max(100, total * RESIDUAL_TOLERANCE) &&
    (target === 0 || difference / target > REBALANCE_TOLERANCE);
}

/**
 * Ordena os déficits por prioridade de aporte: primeiro os ativos fora da
 * tolerância; dentro de cada grupo, o maior desvio relativo ao alvo (gap/meta).
 */
function gapPriority(gaps: number[], targets: number[], flagged: boolean[]): number[] {
  return gaps.map((gap, index) => ({ gap, index }))
    .filter(({ gap }) => gap > 0)
    .sort((a, b) => {
      const flaggedDiff = Number(flagged[b.index]) - Number(flagged[a.index]);
      if (flaggedDiff !== 0) return flaggedDiff;
      return b.gap / targets[b.index] - a.gap / targets[a.index] || a.index - b.index;
    })
    .map(({ index }) => index);
}

/**
 * Enche os gaps na ordem de prioridade; cada item recebe até zerar o déficit.
 * Consome `gaps` (resta o déficit não coberto) e retorna quanto foi alocado.
 */
function fillInOrder(trades: number[], gaps: number[], order: number[], budget: number): number {
  let left = budget;
  for (const index of order) {
    if (left === 0) break;
    const give = Math.min(gaps[index], left);
    trades[index] += give;
    gaps[index] -= give;
    left -= give;
  }
  return budget - left;
}

export function simulateRebalance({
  categories,
  contribution,
  mode,
  manualContributions,
}: RebalanceInput): RebalanceResult {
  const targetSum = categories.reduce((sum, row) => sum + row.targetPct, 0);
  if (!validAllocation(categories.map((row) => row.targetPct))) {
    throw new Error("As metas devem estar entre 0% e 100% e somar 100%.");
  }
  const keys = new Set(categories.map((row) => row.key));
  if (keys.size !== categories.length) throw new Error("Há uma categoria duplicada no cenário.");
  const balances = categories.map((row) => toCents(row.balance));
  const weights = categories.map((row) => row.targetPct / targetSum);
  const budget = toCents(contribution);
  const total = balances.reduce((sum, value) => sum + value, 0);
  const finalTotal = total + budget;
  if (!Number.isSafeInteger(finalTotal)) throw new Error("O total excede o limite de precisão monetária.");
  const targets = splitCents(finalTotal, weights);
  let trades: number[];
  if (mode === "full") {
    trades = targets.map((target, i) => target - balances[i]);
  } else if (manualContributions) {
    if (Object.keys(manualContributions).some((key) => !keys.has(key))) {
      throw new Error("O aporte manual contém uma categoria desconhecida.");
    }
    trades = categories.map((row) => toCents(manualContributions[row.key] ?? 0));
    if (trades.reduce((sum, value) => sum + value, 0) > budget) {
      throw new Error("Os aportes manuais excedem o orçamento disponível. Reduza os valores ou aumente o aporte.");
    }
  } else {
    const gaps = targets.map((target, i) => Math.max(0, target - balances[i]));
    const flagged = targets.map((_, i) => needsAction(balances[i], total, weights[i]));
    // Preenche um déficit por vez, na ordem de prioridade: cada aporte sugerido
    // zera o déficit do ativo; só o primeiro da fila que o orçamento não cobre
    // recebe aporte parcial. Evita "pingar" valores que não mudam o cenário.
    trades = balances.map(() => 0);
    const left = budget - fillInOrder(trades, gaps, gapPriority(gaps, targets, flagged), budget);
    // Sobra só existe quando todos os déficits foram zerados: distribui pelas
    // metas para manter as proporções.
    if (left > 0) {
      const extra = splitCents(left, weights);
      trades = trades.map((trade, i) => trade + extra[i]);
    }
  }

  const remainingCash = budget - trades.reduce((sum, value) => sum + value, 0);
  const rows = categories.map((category, i): RebalanceRow => {
    const after = balances[i] + trades[i];
    return {
      key: category.key,
      currentBRL: balances[i] / 100,
      currentPct: total > 0 ? balances[i] / total : 0,
      targetPct: weights[i],
      targetBRL: targets[i] / 100,
      tradeBRL: trades[i] / 100,
      afterBRL: after / 100,
      afterPct: finalTotal > 0 ? after / finalTotal : 0,
      needsAction: needsAction(balances[i], total, weights[i]),
      afterNeedsAction: needsAction(after, finalTotal, weights[i]),
    };
  });
  const impossibleWithoutSales = balances.some((balance, i) => balance > 0 && weights[i] === 0);
  const requiredTotal = Math.max(total, ...balances.map((balance, i) => weights[i] > 0 ? balance / weights[i] : 0));
  const minimumContribution = impossibleWithoutSales ? null : Math.ceil(Math.max(0, requiredTotal - total)) / 100;

  return {
    rows,
    totalBefore: total / 100,
    totalAfter: finalTotal / 100,
    purchases: trades.reduce((sum, value) => sum + Math.max(0, value), 0) / 100,
    sales: trades.reduce((sum, value) => sum + Math.max(0, -value), 0) / 100,
    remainingCash: remainingCash / 100,
    minimumContribution,
    distanceBefore: total > 0 ? rows.reduce((sum, row) => sum + Math.abs(row.currentPct - row.targetPct), 0) / 2 : 0,
    distanceAfter: finalTotal > 0 ? (rows.reduce((sum, row) => sum + Math.abs(row.afterPct - row.targetPct), 0) + remainingCash / finalTotal) / 2 : 0,
  };
}

export function rebalancePreferenceKey(position: Pick<Position, "name" | "ticker" | "instrumentKey" | "maturity">): string {
  return JSON.stringify([position.instrumentKey ?? instrumentKey(position), position.maturity ?? ""]);
}

export function createRebalanceAssets(positions: Position[], classTargets: Record<string, number>): RebalanceAsset[] {
  const assets = positions.map((position, index): RebalanceAsset => ({
    key: position.id ? `existing:id:${position.id}` : `existing:row:${index}`,
    preferenceKey: rebalancePreferenceKey(position),
    name: position.name,
    ticker: position.ticker,
    maturity: position.maturity,
    assetClass: position.assetClass || "Outros",
    productType: position.productType || "Outros",
    originalBalance: position.balance,
    balance: position.balance,
    future: false,
    targetPct: 0,
    classSharePct: 0,
    productSharePct: 0,
  }));
  for (const dimension of ["assetClass", "productType"] as const) {
    for (const key of new Set(assets.map((asset) => asset[dimension]))) {
      const members = assets.filter((asset) => asset[dimension] === key);
      const balances = members.map((asset) => Number.isFinite(asset.balance) ? Math.max(0, asset.balance) : 0);
      const shares = splitCents(10000, balances.some((value) => value > 0) ? balances : members.map(() => 1));
      members.forEach((asset, index) => {
        if (dimension === "assetClass") {
          asset.classSharePct = shares[index] / 100;
          asset.targetPct = (classTargets[key] ?? 0) * shares[index] / 10000;
        } else {
          asset.productSharePct = shares[index] / 100;
        }
      });
    }
  }
  return assets;
}

function groupShares(assets: RebalanceAsset[], dimension: "assetClass" | "productType", key: string): number[] {
  if (!assets.length) throw new Error(`Adicione um ativo existente ou futuro para a categoria ${key}, ou revise sua meta.`);
  const shares = assets.map((asset) => dimension === "assetClass" ? asset.classSharePct : asset.productSharePct);
  if (!validAllocation(shares)) throw new Error(`Os pesos dos ativos em ${key} devem estar entre 0% e 100% e somar 100%.`);
  const eligible = shares.map((share, i) => assets[i].intent === "exit" ? 0 : share);
  if (!eligible.some((share) => share > 0)) throw new Error(`A categoria ${key} não tem ativo elegível para receber recursos. Inclua um ativo, revise os pesos ou a meta da categoria.`);
  return eligible;
}

/**
 * Combina a meta sugerida de cada ativo com as metas manuais (`targetOverridePct`):
 * ativos com override ficam fixos no valor informado e os demais são redimensionados
 * proporcionalmente para completar 100%. Ativos em saída têm meta efetiva zero.
 */
function applyTargetOverrides(assets: RebalanceAsset[], natural: Map<string, number>): Map<string, number> {
  const effective = new Map<string, number>();
  let overrideSum = 0;
  let naturalSum = 0;
  for (const asset of assets) {
    if (asset.intent === "exit") {
      effective.set(asset.key, 0);
      continue;
    }
    const override = asset.targetOverridePct;
    if (override !== undefined) {
      if (!Number.isFinite(override) || override < 0 || override > 100) {
        throw new Error(`A meta manual de ${asset.name} deve estar entre 0% e 100%.`);
      }
      effective.set(asset.key, override);
      overrideSum += override;
    } else {
      const base = natural.get(asset.key) ?? 0;
      effective.set(asset.key, base);
      naturalSum += base;
    }
  }
  if (overrideSum + naturalSum === 0) {
    throw new Error("Não há ativo elegível para receber recursos. Defina uma meta para um ativo que deseja manter ou adicione um ativo futuro.");
  }
  if (overrideSum > 100.00001) {
    throw new Error("As metas manuais por ativo somam mais de 100%. Ajuste os valores para liberar a simulação.");
  }
  const remainder = Math.max(0, 100 - overrideSum);
  if (naturalSum === 0) {
    if (remainder > 0.05) {
      throw new Error("As metas manuais não somam 100% e não há outro ativo elegível para absorver a diferença.");
    }
    return effective;
  }
  const scale = remainder / naturalSum;
  for (const asset of assets) {
    if (asset.intent === "exit" || asset.targetOverridePct !== undefined) continue;
    effective.set(asset.key, (effective.get(asset.key) ?? 0) * scale);
  }
  return effective;
}

export function assetTargetCategories(
  assets: RebalanceAsset[], dimension: RebalanceDimension, targets: Record<string, number>,
): RebalanceCategory[] {
  const natural = new Map<string, number>();
  if (dimension === "asset") {
    const values = assets.map((asset) => asset.targetPct);
    const hasOverrides = assets.some((asset) => asset.targetOverridePct !== undefined);
    const valid = hasOverrides
      ? values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)
      : validAllocation(values);
    if (!valid) throw new Error("As metas base dos ativos devem estar entre 0% e 100% e somar 100%.");
    for (const asset of assets) natural.set(asset.key, asset.targetPct);
  } else {
    if (!validAllocation(Object.values(targets))) throw new Error("As metas das categorias devem estar entre 0% e 100% e somar 100%.");
    for (const [key, target] of Object.entries(targets)) {
      if (target === 0) continue;
      const members = assets.filter((asset) => asset[dimension] === key);
      const shares = groupShares(members, dimension, key);
      const sum = shares.reduce((acc, value) => acc + value, 0);
      members.forEach((asset, i) => natural.set(asset.key, (natural.get(asset.key) ?? 0) + target * shares[i] / sum));
    }
  }
  const effective = applyTargetOverrides(assets, natural);
  return assets.map((asset) => ({ key: asset.key, balance: asset.balance, targetPct: effective.get(asset.key) ?? 0 }));
}

/**
 * Plano de aporte hierárquico: primeiro cobre o déficit de cada classe (contra
 * as metas por classe) em ordem de prioridade — fora da tolerância antes, depois
 * o maior desvio relativo; dentro da classe, rateia pelos ativos seguindo os
 * mesmos critérios. Déficits internos de classes já na meta só recebem a sobra,
 * e nunca além do que falta para a meta do ativo. O que não couber em déficit
 * algum é repartido pelas metas.
 */
function planGroupContribution(
  assets: RebalanceAsset[],
  categories: RebalanceCategory[],
  dimension: RebalanceDimension,
  groupTargets: Record<string, number>,
  contribution: number,
): Record<string, number> {
  const budget = toCents(contribution);
  const balances = categories.map((category) => toCents(category.balance));
  const total = balances.reduce((sum, value) => sum + value, 0);
  const finalTotal = total + budget;
  if (budget === 0 || finalTotal === 0) return {};
  const targetSum = categories.reduce((sum, category) => sum + category.targetPct, 0);
  const weights = categories.map((category) => category.targetPct / targetSum);
  const memberTargets = splitCents(finalTotal, weights);
  const memberGaps = memberTargets.map((target, i) => Math.max(0, target - balances[i]));
  const memberFlagged = memberTargets.map((_, i) => needsAction(balances[i], total, weights[i]));
  const memberOrder = gapPriority(memberGaps, memberTargets, memberFlagged);

  const groupField = dimension === "productType" ? "productType" : "assetClass";
  const groups = new Map<string, number[]>();
  assets.forEach((asset, i) => {
    const members = groups.get(asset[groupField]) ?? [];
    members.push(i);
    groups.set(asset[groupField], members);
  });
  const groupTargetSum = Object.values(groupTargets).reduce((sum, value) => sum + value, 0);
  const groupWeightsValid = validAllocation(Object.values(groupTargets));
  const rankedGroups = [...groups.values()].map((memberIdx) => {
    const balance = memberIdx.reduce((sum, i) => sum + balances[i], 0);
    const weight = groupWeightsValid
      ? (groupTargets[assets[memberIdx[0]][groupField]] ?? 0) / groupTargetSum
      : memberIdx.reduce((sum, i) => sum + weights[i], 0);
    const target = Math.floor(weight * finalTotal);
    return {
      members: new Set(memberIdx),
      gap: Math.max(0, target - balance),
      target,
      flagged: needsAction(balance, total, weight),
    };
  }).filter((group) => group.gap > 0)
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.gap / b.target - a.gap / a.target);

  const trades = balances.map(() => 0);
  let left = budget;
  // 1. classes abaixo da meta, por prioridade; dentro delas, ativos por prioridade
  for (const group of rankedGroups) {
    if (left === 0) break;
    const order = memberOrder.filter((index) => group.members.has(index));
    left -= fillInOrder(trades, memberGaps, order, Math.min(group.gap, left));
  }
  // 2. déficits residuais de ativos em classes já na meta
  left -= fillInOrder(trades, memberGaps, memberOrder, left);
  // 3. tudo na meta: reparte a sobra pelas metas para manter as proporções
  if (left > 0) {
    const extra = splitCents(left, weights);
    extra.forEach((value, i) => trades[i] += value);
  }
  return Object.fromEntries(
    assets.map((asset, i) => [asset.key, trades[i] / 100] as const).filter(([, value]) => value > 0),
  );
}

export function simulateAssetRebalance({
  assets, dimension, targets, contribution, mode, manualContributions, manualDimension = dimension,
}: AssetRebalanceInput): RebalanceResult {
  if (assets.some((asset) => asset.future && (asset.balance !== 0 || asset.originalBalance !== 0))) {
    throw new Error("Ativos futuros devem ter saldo inicial zero. Use aportes ou resgates para financiá-los.");
  }
  const categories = assetTargetCategories(assets, dimension, targets);
  let manual = manualContributions;
  if (mode === "contribution" && manual && manualDimension !== "asset") {
    const entries: [string, number][] = [];
    for (const [key, value] of Object.entries(manual)) {
      const amount = toCents(value);
      if (amount === 0) continue;
      const members = assets.filter((asset) => asset[manualDimension] === key);
      const amounts = splitCents(amount, groupShares(members, manualDimension, key));
      members.forEach((asset, i) => entries.push([asset.key, amounts[i] / 100]));
    }
    manual = Object.fromEntries(entries);
  }
  if (mode === "contribution" && manual && assets.some((asset) => asset.intent === "exit" && (manual[asset.key] ?? 0) > 0)) {
    throw new Error("Um ativo marcado para saída não pode receber aportes. Remova o aporte ou altere a intenção para Manter.");
  }
  const ideal = simulateRebalance({ categories, contribution, mode,
    manualContributions: manual ?? (mode === "contribution"
      ? planGroupContribution(assets, categories, dimension, targets, contribution)
      : undefined) });
  const locked = new Set(assets.filter((asset) => asset.intent === "exit" && !asset.allowExitSale).map((asset) => asset.key));
  if (mode !== "full" || locked.size === 0) return ideal;
  const available = simulateRebalance({ categories: categories.filter((row) => !locked.has(row.key)), contribution, mode });
  const trades = new Map(available.rows.map((row) => [row.key, row.tradeBRL]));
  const rows = ideal.rows.map((row) => {
    const tradeBRL = trades.get(row.key) ?? 0;
    const afterCents = toCents(row.currentBRL) + Math.round(tradeBRL * 100);
    return { ...row, tradeBRL, afterBRL: afterCents / 100,
      afterPct: ideal.totalAfter > 0 ? afterCents / toCents(ideal.totalAfter) : 0,
      afterNeedsAction: needsAction(afterCents, toCents(ideal.totalAfter), row.targetPct) };
  });
  return { ...ideal, rows, purchases: available.purchases, sales: available.sales,
    distanceAfter: ideal.totalAfter > 0 ? rows.reduce((sum, row) => sum + Math.abs(row.afterPct - row.targetPct), 0) / 2 : 0 };
}

export interface RebalanceSummary {
  key: string;
  label: string;
  currentBRL: number;
  targetBRL: number;
  afterBRL: number;
  targetPct: number;
  purchases: number;
  sales: number;
}

export function summarizeRebalance(
  result: RebalanceResult, assets: RebalanceAsset[], dimension: RebalanceDimension,
): RebalanceSummary[] {
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const groups = new Map<string, RebalanceSummary>();
  for (const row of result.rows) {
    const asset = byKey.get(row.key);
    if (!asset) throw new Error("Ativo não encontrado no cenário.");
    const key = dimension === "asset" ? asset.key : asset[dimension];
    const group = groups.get(key) ?? {
      key, label: dimension === "asset" ? asset.name : key,
      currentBRL: 0, targetBRL: 0, afterBRL: 0, targetPct: 0, purchases: 0, sales: 0,
    };
    group.currentBRL += toCents(row.currentBRL);
    group.targetBRL += toCents(row.targetBRL);
    group.afterBRL += toCents(row.afterBRL);
    group.targetPct += row.targetPct;
    group.purchases += toCents(Math.max(0, row.tradeBRL));
    group.sales += toCents(Math.max(0, -row.tradeBRL));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group, currentBRL: group.currentBRL / 100, targetBRL: group.targetBRL / 100,
    afterBRL: group.afterBRL / 100, purchases: group.purchases / 100, sales: group.sales / 100,
  }));
}

export interface GroupedMetrics {
  distanceBefore: number;
  distanceAfter: number;
  before: number;
  after: number;
}

export function summarizeMetrics(
  result: RebalanceResult,
  assets: RebalanceAsset[],
  dimension: RebalanceDimension,
  groupTargets?: Record<string, number>,
): GroupedMetrics {
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  const groups = new Map<string, { current: number; after: number; impliedTarget: number }>();
  for (const row of result.rows) {
    const asset = byKey.get(row.key);
    if (!asset) throw new Error("Ativo não encontrado no cenário.");
    const key = dimension === "asset" ? asset.key : asset[dimension];
    const group = groups.get(key) ?? { current: 0, after: 0, impliedTarget: 0 };
    group.current += toCents(row.currentBRL);
    group.after += toCents(row.afterBRL);
    group.impliedTarget += row.targetPct;
    groups.set(key, group);
  }
  if (dimension !== "asset" && groupTargets) {
    for (const [key, target] of Object.entries(groupTargets)) {
      if (target > 0 && !groups.has(key)) groups.set(key, { current: 0, after: 0, impliedTarget: 0 });
    }
  }
  const totalBefore = toCents(result.totalBefore);
  const totalAfter = toCents(result.totalAfter);
  const metrics: GroupedMetrics = { distanceBefore: 0, distanceAfter: 0, before: 0, after: 0 };
  for (const [key, group] of groups) {
    const weight = dimension !== "asset" && groupTargets?.[key] !== undefined
      ? groupTargets[key] / 100
      : group.impliedTarget;
    if (totalBefore > 0) metrics.distanceBefore += Math.abs(group.current / totalBefore - weight);
    if (totalAfter > 0) metrics.distanceAfter += Math.abs(group.after / totalAfter - weight);
    if (needsAction(group.current, totalBefore, weight)) metrics.before += 1;
    if (needsAction(group.after, totalAfter, weight)) metrics.after += 1;
  }
  if (totalAfter > 0) metrics.distanceAfter += toCents(result.remainingCash) / totalAfter;
  metrics.distanceBefore /= 2;
  metrics.distanceAfter /= 2;
  return metrics;
}
