import type { RetirementPlan } from "./types";

export interface ProjectionPoint {
  age: number;
  patrimonio: number;
}

export interface RetirementResult {
  /** patrimônio projetado na idade de início dos resgates */
  accumulated: number;
  /** renda anual desejada / patrimônio acumulado (fração, ex.: 0.074) */
  annualWithdrawalRate: number;
  /** idade em que o patrimônio zera; null = não se esgota até MAX_AGE */
  depletionAge: number | null;
  /** série do patrimônio projetado (um ponto por ano) */
  points: ProjectionPoint[];
}

const MAX_AGE = 110;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** taxa mensal equivalente a uma taxa anual em % (ex.: 7 -> ~0.5654%) */
export function monthlyRealRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/**
 * Simula mês a mês: aportes até `retirementAge`, depois retiradas de
 * `desiredMonthlyIncome`, sempre rendendo a taxa real mensal.
 */
export function simulateRetirement(plan: RetirementPlan): RetirementResult {
  const r = monthlyRealRate(plan.realReturnPct);
  const accumMonths = Math.max(
    0,
    Math.round((plan.retirementAge - plan.currentAge) * 12),
  );
  const totalMonths = Math.max(
    0,
    Math.round((MAX_AGE - plan.currentAge) * 12),
  );

  let balance = plan.initialValue;
  let accumulated = balance;
  let depletionAge: number | null = null;

  const points: ProjectionPoint[] = [
    { age: plan.currentAge, patrimonio: balance },
  ];

  for (let m = 1; m <= totalMonths; m++) {
    if (m <= accumMonths) {
      balance = balance * (1 + r) + plan.monthlyContribution;
      if (m === accumMonths) accumulated = balance;
    } else {
      balance = balance * (1 + r) - plan.desiredMonthlyIncome;
      if (balance <= 0) {
        depletionAge = plan.currentAge + m / 12;
        points.push({ age: depletionAge, patrimonio: 0 });
        break;
      }
    }
    if (m % 12 === 0 || m === accumMonths) {
      points.push({ age: plan.currentAge + m / 12, patrimonio: balance });
    }
  }

  return {
    accumulated,
    annualWithdrawalRate:
      accumulated > 0 ? (plan.desiredMonthlyIncome * 12) / accumulated : 0,
    depletionAge,
    points,
  };
}

export interface HistoryEstimate {
  /** rentabilidade mensal implícita do histórico (aportes já separados) */
  monthlyRate: number;
  /** taxa anual equivalente, em fração (ex.: 0.12) */
  annualRate: number;
  /** aporte médio mensal estimado (Δ total investido / meses) */
  monthlyContribution: number;
  /** projeção a partir da última importação */
  points: ProjectionPoint[];
  depletionAge: number | null;
}

export interface TrajectoryDynamics {
  /** rentabilidade mensal observada (fração) */
  monthlyRate: number;
  /** fluxo médio mensal observado (aportes − resgates) */
  monthlyContribution: number;
}

/**
 * Dinâmica a partir do CSV anual da XP: média geométrica da rentabilidade
 * anual e média dos fluxos (movimentações). O ano corrente é ignorado
 * (dados parciais).
 */
export function dynamicsFromWealth(
  years: { year: number; flows: number; returnPct: number }[],
  currentYear = new Date().getFullYear(),
): TrajectoryDynamics {
  const complete = years.filter((y) => y.year < currentYear);
  const use = complete.length > 0 ? complete : years;
  let prod = 1;
  let flows = 0;
  for (const y of use) {
    prod *= 1 + y.returnPct;
    flows += y.flows;
  }
  const months = use.length * 12;
  return {
    monthlyRate: Math.pow(prod, 1 / months) - 1,
    monthlyContribution: flows / months,
  };
}

/**
 * Fallback sem CSV: tendência linear do patrimônio entre a primeira e a
 * última importação (R$/mês). Não dá para separar aporte de rendimento só
 * pelo patrimônio — então rende 0% e cresce no ritmo absoluto observado.
 */
export function dynamicsFromImports(
  imports: { date: number; patrimonio: number }[],
): TrajectoryDynamics | null {
  if (imports.length < 2) return null;
  const sorted = [...imports].sort((a, b) => a.date - b.date);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const months = ((last.date - first.date) / MS_PER_YEAR) * 12;
  if (months < 1) return null;
  return {
    monthlyRate: 0,
    monthlyContribution: (last.patrimonio - first.patrimonio) / months,
  };
}

/**
 * Extrapola a trajetória observada: a partir do ponto âncora, o patrimônio
 * rende a taxa observada e recebe o fluxo observado até a idade de resgate;
 * depois passa a descontar a renda mensal desejada.
 */
export function simulateEstimated(
  anchor: { date: number; patrimonio: number },
  dyn: TrajectoryDynamics,
  plan: RetirementPlan,
  now = Date.now(),
): HistoryEstimate {
  const last = anchor;

  const startAge = plan.currentAge + (last.date - now) / MS_PER_YEAR;
  const totalMonths = Math.max(0, Math.round((MAX_AGE - startAge) * 12));

  let balance = last.patrimonio;
  let depletionAge: number | null = null;
  const points: ProjectionPoint[] = [{ age: startAge, patrimonio: balance }];

  for (let m = 1; m <= totalMonths; m++) {
    const age = startAge + m / 12;
    if (age <= plan.retirementAge) {
      balance = balance * (1 + dyn.monthlyRate) + dyn.monthlyContribution;
    } else {
      balance = balance * (1 + dyn.monthlyRate) - plan.desiredMonthlyIncome;
      if (balance <= 0) {
        depletionAge = age;
        points.push({ age, patrimonio: 0 });
        break;
      }
    }
    if (m % 12 === 0) points.push({ age, patrimonio: balance });
  }

  return {
    monthlyRate: dyn.monthlyRate,
    annualRate: Math.pow(1 + dyn.monthlyRate, 12) - 1,
    monthlyContribution: dyn.monthlyContribution,
    points,
    depletionAge,
  };
}

/** timestamp do fim do ano; ano corrente conta como YTD (agora) */
export function yearEndTs(year: number, now = Date.now()): number {
  return Math.min(new Date(year, 11, 31, 23, 59).getTime(), now);
}
