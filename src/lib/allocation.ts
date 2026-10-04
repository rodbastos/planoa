import type { AllocationSlice, Position, Targets } from "./types";

export function totalBalance(positions: Position[]): number {
  return positions.reduce((acc, p) => acc + (p.balance || 0), 0);
}

export function groupBy(
  positions: Position[],
  key: "assetClass" | "productType" | "sourceSection",
): AllocationSlice[] {
  const map = new Map<string, number>();
  for (const p of positions) {
    const k = p[key] || "Outros";
    map.set(k, (map.get(k) ?? 0) + (p.balance || 0));
  }
  const total = totalBalance(positions) || 1;
  return [...map.entries()]
    .map(([k, balance]) => ({ key: k, balance, pct: balance / total }))
    .sort((a, b) => b.balance - a.balance);
}

export interface DeltaRow {
  key: string;
  currentPct: number;
  targetPct: number;
  currentBRL: number;
  targetBRL: number;
  deltaBRL: number; // positivo = falta alocar (comprar); negativo = excesso
  /** desvio relativo ao alvo: (atual − alvo) / alvo; +0,20 = 20% acima do alvo */
  deviation: number;
  /** true quando o desvio passa das tolerâncias e vale agir */
  needsAction: boolean;
}

/** tolerância de desvio relativo ao alvo antes de sugerir aporte/resgate (±20%) */
export const REBALANCE_TOLERANCE = 0.2;

/** diferença em R$ abaixo desta fração do patrimônio total é residual (0,25%) */
export const RESIDUAL_TOLERANCE = 0.0025;

/** Compara alocação atual vs carteira ideal */
export function compareWithTargets(
  positions: Position[],
  targets: Record<string, number>,
  key: "assetClass" | "productType",
  order?: readonly string[],
): DeltaRow[] {
  const slices = groupBy(positions, key);
  const total = totalBalance(positions);
  const keys = new Set<string>([...slices.map((s) => s.key), ...Object.keys(targets)]);
  const rows: DeltaRow[] = [];
  for (const k of keys) {
    const cur = slices.find((s) => s.key === k);
    const currentPct = cur?.pct ?? 0;
    const targetPct = (targets[k] ?? 0) / 100;
    const currentBRL = cur?.balance ?? 0;
    const targetBRL = targetPct * total;
    const deltaBRL = targetBRL - currentBRL;
    const deviation =
      targetBRL > 0
        ? (currentBRL - targetBRL) / targetBRL
        : currentBRL > 0
          ? Infinity
          : 0;
    rows.push({
      key: k,
      currentPct,
      targetPct,
      currentBRL,
      targetBRL,
      deltaBRL,
      deviation,
      needsAction:
        Math.abs(deviation) > REBALANCE_TOLERANCE &&
        Math.abs(deltaBRL) > Math.max(1, RESIDUAL_TOLERANCE * total),
    });
  }
  if (order) {
    const rank = new Map(order.map((k, i) => [k, i]));
    return rows.sort(
      (a, b) => (rank.get(a.key) ?? order.length) - (rank.get(b.key) ?? order.length),
    );
  }
  return rows.sort((a, b) => Math.abs(b.deltaBRL) - Math.abs(a.deltaBRL));
}

export const EMPTY_TARGETS: Targets = { byAssetClass: {}, byProductType: {} };

export function targetsSum(targets: Record<string, number>): number {
  return Object.values(targets).reduce((a, b) => a + (b || 0), 0);
}
