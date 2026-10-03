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

function annuityFV(r: number, months: number): number {
  return r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
}

const clampRate = (r: number) => Math.min(Math.max(r, -0.1), 0.1);

/**
 * Resolve, por bissecção, a taxa mensal r tal que
 * pv*(1+r)^m + pmt*annuity(m,r) = fv.
 * É o que separa rendimento de aporte no histórico.
 */
export function impliedMonthlyRate(
  pv: number,
  pmt: number,
  months: number,
  fv: number,
): number {
  const f = (r: number) =>
    pv * Math.pow(1 + r, months) + pmt * annuityFV(r, months) - fv;
  let lo = -0.5;
  let hi = 0.5;
  if (f(lo) >= 0) return lo;
  if (f(hi) <= 0) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Estima a dinâmica observada: aporte médio mensal (Δ total investido) e
 * rentabilidade mensal implícita. Sem "total investido" nos extremos, trata
 * todo o crescimento como rendimento (aporte = 0). Taxa limitada a ±10%/mês.
 */
export function estimateDynamics(
  imports: { date: number; patrimonio: number; totalInvestido?: number }[],
): { monthlyRate: number; monthlyContribution: number } | null {
  if (imports.length < 2) return null;
  const sorted = [...imports].sort((a, b) => a.date - b.date);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const months = ((last.date - first.date) / MS_PER_YEAR) * 12;
  if (months < 1 || first.patrimonio <= 0 || last.patrimonio <= 0) return null;

  if (first.totalInvestido === undefined || last.totalInvestido === undefined) {
    const cagr = Math.pow(last.patrimonio / first.patrimonio, 1 / months) - 1;
    return { monthlyRate: clampRate(cagr), monthlyContribution: 0 };
  }

  const pmt = (last.totalInvestido - first.totalInvestido) / months;
  const r = impliedMonthlyRate(first.patrimonio, pmt, months, last.patrimonio);
  return { monthlyRate: clampRate(r), monthlyContribution: pmt };
}

/**
 * Extrapola a trajetória observada: a partir da última importação, o
 * patrimônio rende a taxa implícita e recebe o aporte estimado até a idade
 * de resgate; depois passa a descontar a renda mensal desejada.
 */
export function simulateEstimated(
  imports: { date: number; patrimonio: number; totalInvestido?: number }[],
  plan: RetirementPlan,
  now = Date.now(),
): HistoryEstimate | null {
  const dyn = estimateDynamics(imports);
  if (!dyn) return null;
  const last = [...imports].sort((a, b) => a.date - b.date)[
    imports.length - 1
  ];

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
