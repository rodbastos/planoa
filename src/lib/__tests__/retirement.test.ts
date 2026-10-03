import { describe, expect, it } from "vitest";
import {
  estimateDynamics,
  impliedMonthlyRate,
  monthlyRealRate,
  simulateEstimated,
  simulateRetirement,
} from "../retirement";
import type { RetirementPlan } from "../types";

const base: RetirementPlan = {
  realReturnPct: 7,
  currentAge: 49,
  retirementAge: 64,
  initialValue: 1_500_000,
  monthlyContribution: 5_000,
  desiredMonthlyIncome: 35_000,
};

describe("monthlyRealRate", () => {
  it("converte taxa anual em mensal equivalente", () => {
    const r = monthlyRealRate(7);
    expect(Math.pow(1 + r, 12)).toBeCloseTo(1.07, 10);
    expect(r).toBeCloseTo(0.005654, 4);
  });
});

describe("simulateRetirement", () => {
  it("acumula valor inicial + aportes até a idade de resgate", () => {
    const r = simulateRetirement(base);
    // FV(7% a.a., 180 meses, -5000, -1.5M) ≈ 5,7M
    expect(r.accumulated).toBeGreaterThan(5_000_000);
    expect(r.accumulated).toBeLessThan(7_000_000);
  });

  it("taxa anual de retirada = renda anual / patrimônio acumulado", () => {
    const r = simulateRetirement(base);
    expect(r.annualWithdrawalRate).toBeCloseTo(
      (35_000 * 12) / r.accumulated,
      10,
    );
  });

  it("patrimônio se esgota quando a retirada supera os juros reais", () => {
    const r = simulateRetirement(base);
    expect(r.depletionAge).not.toBeNull();
    expect(r.depletionAge!).toBeGreaterThan(64);
    expect(r.points[r.points.length - 1].patrimonio).toBe(0);
  });

  it("nunca se esgota quando a renda é menor que os juros mensais", () => {
    const r = simulateRetirement({ ...base, desiredMonthlyIncome: 1_000 });
    expect(r.depletionAge).toBeNull();
    const last = r.points[r.points.length - 1];
    expect(last.patrimonio).toBeGreaterThan(r.accumulated);
  });

  it("sem fase de acumulação quando resgate começa na idade atual", () => {
    const r = simulateRetirement({ ...base, retirementAge: 49 });
    expect(r.accumulated).toBe(base.initialValue);
    expect(r.points[0].age).toBe(49);
  });

  it("registra o ponto exato na idade de resgate", () => {
    const r = simulateRetirement(base);
    const atRetire = r.points.find((p) => p.age === 64);
    expect(atRetire).toBeDefined();
    expect(atRetire!.patrimonio).toBeCloseTo(r.accumulated, 6);
  });
});

describe("impliedMonthlyRate", () => {
  it("recupera a taxa usada para gerar o fluxo", () => {
    const r = monthlyRealRate(7);
    const fv =
      1_000_000 * 1.07 + 5_000 * ((Math.pow(1 + r, 12) - 1) / r);
    expect(impliedMonthlyRate(1_000_000, 5_000, 12, fv)).toBeCloseTo(r, 6);
  });
});

describe("estimateDynamics", () => {
  const now = Date.now();
  const ano = 365.25 * 24 * 60 * 60 * 1000;

  it("separa aporte de rentabilidade usando o total investido", () => {
    const r = monthlyRealRate(7);
    const fv =
      1_000_000 * 1.07 + 5_000 * ((Math.pow(1 + r, 12) - 1) / r);
    const imports = [
      { date: now - ano, patrimonio: 1_000_000, totalInvestido: 940_000 },
      { date: now, patrimonio: fv, totalInvestido: 1_000_000 },
    ];
    const dyn = estimateDynamics(imports)!;
    expect(dyn.monthlyContribution).toBeCloseTo(5_000, 6);
    expect(dyn.monthlyRate).toBeCloseTo(r, 4);
  });

  it("sem total investido, trata todo o crescimento como rendimento", () => {
    const imports = [
      { date: now - ano, patrimonio: 1_000_000 },
      { date: now, patrimonio: 1_070_000 },
    ];
    const dyn = estimateDynamics(imports)!;
    expect(dyn.monthlyContribution).toBe(0);
    expect(dyn.monthlyRate).toBeCloseTo(monthlyRealRate(7), 4);
  });

  it("retorna null com menos de duas importações", () => {
    expect(estimateDynamics([])).toBeNull();
    expect(
      estimateDynamics([{ date: now, patrimonio: 1_000_000 }]),
    ).toBeNull();
  });
});

describe("simulateEstimated", () => {
  const now = Date.now();
  const ano = 365.25 * 24 * 60 * 60 * 1000;
  const r = monthlyRealRate(7);
  const fv = 1_000_000 * 1.07 + 5_000 * ((Math.pow(1 + r, 12) - 1) / r);
  const imports = [
    { date: now - ano, patrimonio: 1_000_000, totalInvestido: 940_000 },
    { date: now, patrimonio: fv, totalInvestido: 1_000_000 },
  ];

  it("parte do patrimônio da última importação, na idade atual", () => {
    const est = simulateEstimated(imports, base, now)!;
    expect(est.annualRate).toBeCloseTo(0.07, 3);
    expect(est.monthlyContribution).toBeCloseTo(5_000, 6);
    expect(est.points[0].age).toBeCloseTo(49, 1);
    expect(est.points[0].patrimonio).toBe(fv);
  });

  it("desconta a renda desejada após a idade de resgate e esgota", () => {
    const est = simulateEstimated(imports, base, now)!;
    expect(est.depletionAge).not.toBeNull();
    expect(est.depletionAge!).toBeGreaterThan(64);
    expect(est.points[est.points.length - 1].patrimonio).toBe(0);
  });

  it("não se esgota com renda menor que os juros da trajetória", () => {
    const est = simulateEstimated(imports, {
      ...base,
      desiredMonthlyIncome: 1_000,
    })!;
    expect(est.depletionAge).toBeNull();
  });

  it("retorna null sem histórico suficiente", () => {
    expect(simulateEstimated([], base)).toBeNull();
  });
});
