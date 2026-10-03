import { describe, expect, it } from "vitest";
import {
  dynamicsFromImports,
  dynamicsFromWealth,
  monthlyRealRate,
  simulateEstimated,
  simulateRetirement,
} from "../retirement";
import type { RetirementPlan } from "../types";

const base: RetirementPlan = {
  nominalReturnPct: 7,
  inflationPct: 0, // inflação 0 -> nominal = real nos testes
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

describe("dynamicsFromWealth", () => {
  it("média geométrica da rentabilidade e média dos fluxos", () => {
    const dyn = dynamicsFromWealth(
      [
        { year: 2023, flows: 120_000, returnPct: 0.1 },
        { year: 2024, flows: 60_000, returnPct: 0.2 },
      ],
      0,
      2025,
    );
    // geo mean de 10% e 20% a.a. ≈ 14,89% a.a.
    expect(Math.pow(1 + dyn.monthlyRate, 12)).toBeCloseTo(
      Math.sqrt(1.1 * 1.2),
      6,
    );
    expect(dyn.monthlyContribution).toBeCloseTo(180_000 / 24, 6);
  });

  it("deflaciona a rentabilidade nominal para termos reais", () => {
    const dyn = dynamicsFromWealth(
      [{ year: 2024, flows: 120_000, returnPct: 0.1 }],
      4.5,
      2025,
    );
    // 10% nominal / 4,5% inflação ≈ 5,26% real a.a.
    expect(Math.pow(1 + dyn.monthlyRate, 12)).toBeCloseTo(1.1 / 1.045, 4);
    // nominal preservado para exibição
    expect(dyn.nominalMonthlyRate).toBeCloseTo(monthlyRealRate(10), 4);
  });

  it("ignora o ano corrente (parcial)", () => {
    const dyn = dynamicsFromWealth(
      [
        { year: 2024, flows: 120_000, returnPct: 0.1 },
        { year: 2025, flows: 5_000, returnPct: 0.5 },
      ],
      0,
      2025,
    );
    expect(dyn.monthlyContribution).toBeCloseTo(120_000 / 12, 6);
    expect(dyn.monthlyRate).toBeCloseTo(monthlyRealRate(10), 4);
  });
});

describe("dynamicsFromImports", () => {
  const now = Date.now();
  const ano = 365.25 * 24 * 60 * 60 * 1000;

  it("tendência linear do patrimônio (R$/mês, taxa 0)", () => {
    const imports = [
      { date: now - ano, patrimonio: 1_000_000 },
      { date: now, patrimonio: 1_120_000 },
    ];
    const dyn = dynamicsFromImports(imports)!;
    expect(dyn.monthlyRate).toBe(0);
    expect(dyn.monthlyContribution).toBeCloseTo(120_000 / 12, 0);
  });

  it("retorna null com menos de duas importações", () => {
    expect(dynamicsFromImports([])).toBeNull();
    expect(
      dynamicsFromImports([{ date: now, patrimonio: 1_000_000 }]),
    ).toBeNull();
  });
});

describe("simulateEstimated", () => {
  const now = Date.now();
  const anchor = { date: now, patrimonio: 1_131_901 };
  const dyn = { monthlyRate: monthlyRealRate(7), monthlyContribution: 5_000 };

  it("parte do ponto âncora, na idade atual", () => {
    const est = simulateEstimated(anchor, dyn, base, now);
    expect(est.annualRate).toBeCloseTo(0.07, 3);
    expect(est.monthlyContribution).toBe(5_000);
    expect(est.points[0].age).toBeCloseTo(49, 1);
    expect(est.points[0].patrimonio).toBe(anchor.patrimonio);
  });

  it("desconta a renda desejada após a idade de resgate e esgota", () => {
    const est = simulateEstimated(anchor, dyn, base, now);
    expect(est.depletionAge).not.toBeNull();
    expect(est.depletionAge!).toBeGreaterThan(64);
    expect(est.points[est.points.length - 1].patrimonio).toBe(0);
  });

  it("não se esgota com renda menor que os juros da trajetória", () => {
    const est = simulateEstimated(anchor, dyn, {
      ...base,
      desiredMonthlyIncome: 1_000,
    });
    expect(est.depletionAge).toBeNull();
  });
});
