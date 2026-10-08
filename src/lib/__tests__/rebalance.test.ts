import { describe, expect, it } from "vitest";
import {
  createRebalanceAssets,
  rebalancePreferenceKey,
  simulateAssetRebalance,
  simulateRebalance,
  summarizeMetrics,
  summarizeRebalance,
  type RebalanceAsset,
  type RebalanceInput,
} from "../rebalance";
import type { Position } from "../types";

const base: RebalanceInput = {
  categories: [
    { key: "Renda fixa", balance: 8000, targetPct: 50 },
    { key: "Ações", balance: 2000, targetPct: 50 },
  ],
  contribution: 2000,
  mode: "contribution",
};

const cents = (value: number) => Math.round(value * 100);

const positions: Position[] = [
  { id: "cdb1", name: "CDB Banco A", balance: 6000, assetClass: "CDI", productType: "CDB", sourceSection: "RF", allocationPct: 0 },
  { id: "cdb2", name: "CDB Banco B", balance: 2000, assetClass: "CDI", productType: "CDB", sourceSection: "RF", allocationPct: 0 },
  { id: "acao", name: "PETR4", balance: 2000, assetClass: "RV", productType: "Ações", sourceSection: "RV", allocationPct: 0 },
];
const groupTargets = { CDI: 50, RV: 50 };
const assets = () => createRebalanceAssets(positions, groupTargets);
const future = (): RebalanceAsset => ({
  key: "future:1", name: "Novo ETF", assetClass: "RV", productType: "ETF", balance: 0,
  originalBalance: 0, future: true, targetPct: 10, classSharePct: 20, productSharePct: 100,
});

describe("rebalanceamento por ativo", () => {
  it("usa posições existentes e reparte a meta da classe proporcionalmente ao saldo importado", () => {
    const rows = assets();
    expect(rows.map((row) => row.targetPct)).toEqual([37.5, 12.5, 50]);
    expect(rows.map((row) => row.classSharePct)).toEqual([75, 25, 100]);
    expect(rows.every((row) => !row.future)).toBe(true);
    expect(positions[0].balance).toBe(6000);
  });

  it("distingue posições com nomes iguais, sem perder saldos", () => {
    const rows = createRebalanceAssets(positions.map((row) => ({ ...row, name: "Mesmo nome" })), groupTargets);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(rows.reduce((sum, row) => sum + row.balance, 0)).toBe(10000);
  });

  it("gera compras e resgates individuais mesmo com metas por classe", () => {
    const result = simulateAssetRebalance({ assets: assets(), dimension: "assetClass", targets: groupTargets, contribution: 2000, mode: "full" });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([-1500, -500, 4000]);
    expect(result.rows.map((row) => row.afterBRL)).toEqual([4500, 1500, 6000]);
  });

  it("detecta desvio entre ativos da mesma classe após mudança de preços", () => {
    const rows = assets();
    rows[0].balance = 7000;
    rows[1].balance = 1000;
    const result = simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 0, mode: "full" });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([-3250, 250, 3000]);
  });

  it("adiciona um ativo futuro sem criar patrimônio inicial", () => {
    const rows = assets();
    rows[2].targetPct = 40;
    const result = simulateAssetRebalance({ assets: [...rows, future()], dimension: "asset", targets: {}, contribution: 2000, mode: "full" });
    expect(result.totalBefore).toBe(10000);
    expect(result.totalAfter).toBe(12000);
    expect(result.rows[3].currentBRL).toBe(0);
    expect(result.rows[3].tradeBRL).toBe(1200);
    expect(result.rows.every((row) => row.afterBRL >= 0)).toBe(true);
  });

  it("rebalanceia para um ativo futuro apenas com o novo aporte, sem vendas", () => {
    const rows = assets();
    rows[2].targetPct = 40;
    const result = simulateAssetRebalance({ assets: [...rows, future()], dimension: "asset", targets: {}, contribution: 2000, mode: "contribution" });
    expect(result.sales).toBe(0);
    expect(result.rows[3].tradeBRL).toBeGreaterThan(0);
    expect(result.purchases).toBe(2000);
  });

  it("exige uma escolha explícita da participação do novo ativo na classe", () => {
    expect(() => simulateAssetRebalance({ assets: [...assets(), future()], dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "full" })).toThrow(/pesos.*RV.*100%/);
    const rows = assets();
    rows[2].classSharePct = 80;
    const result = simulateAssetRebalance({ assets: [...rows, future()], dimension: "assetClass", targets: groupTargets, contribution: 0, mode: "full" });
    expect(result.rows[3].targetPct).toBeCloseTo(0.1);
  });

  it("não inventa ativos para categorias com meta mas sem posições", () => {
    expect(() => simulateAssetRebalance({ assets: assets(), dimension: "productType", targets: { CDB: 50, ETF: 50 }, contribution: 1000, mode: "full" })).toThrow(/Adicione.*ETF/);
  });

  it("permite investir em categoria nova após cadastrar um ativo futuro", () => {
    const result = simulateAssetRebalance({ assets: [...assets(), future()], dimension: "productType", targets: { CDB: 50, ETF: 50 }, contribution: 0, mode: "full" });
    expect(result.rows[3].afterBRL).toBe(5000);
    expect(result.rows[2].afterBRL).toBe(0);
  });

  it("divide aporte manual por classe entre os ativos conforme os pesos definidos", () => {
    const result = simulateAssetRebalance({ assets: assets(), dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "contribution", manualContributions: { CDI: 999.99 } });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([749.99, 250, 0]);
    expect(result.remainingCash).toBe(0.01);
  });

  it("direciona aporte manual para um ativo específico existente ou futuro", () => {
    const rows = assets();
    rows[2].targetPct = 40;
    const result = simulateAssetRebalance({ assets: [...rows, future()], dimension: "asset", targets: {}, contribution: 1000, mode: "contribution", manualContributions: { "future:1": 1000 } });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([0, 0, 0, 1000]);
  });

  it("rejeita aportes manuais para categoria sem ativo e orçamento excedido", () => {
    expect(() => simulateAssetRebalance({ assets: assets(), dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "contribution", manualContributions: { Outra: 100 } })).toThrow(/ativo/);
    expect(() => simulateAssetRebalance({ assets: assets(), dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "contribution", manualContributions: { CDI: 1000.01 } })).toThrow(/orçamento/);
  });

  it("impede que um ativo futuro crie saldo anterior fictício", () => {
    expect(() => simulateAssetRebalance({ assets: [...assets(), { ...future(), balance: 100 }], dimension: "asset", targets: {}, contribution: 1000, mode: "full" })).toThrow(/saldo inicial zero/);
  });

  it("valida metas de grupos antes de distribuí-las e rejeita pesos inválidos", () => {
    expect(() => simulateAssetRebalance({ assets: assets(), dimension: "assetClass", targets: { CDI: 90 }, contribution: 1000, mode: "full" })).toThrow(/metas/);
    const rows = assets();
    rows[0].classSharePct = -25;
    expect(() => simulateAssetRebalance({ assets: rows, dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "full" })).toThrow(/pesos/);
  });

  it("consolida resultados sem esconder compras e vendas dentro da mesma classe", () => {
    const rows = assets();
    rows[0].targetPct = 50;
    rows[1].targetPct = 30;
    rows[2].targetPct = 20;
    const result = simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 0, mode: "full" });
    const summary = summarizeRebalance(result, rows, "assetClass");
    expect(summary[0].key).toBe("CDI");
    expect(summary[0].purchases).toBe(1000);
    expect(summary[0].sales).toBe(1000);
    expect(summary[0].afterBRL).toBe(8000);
    expect(summary.reduce((sum, row) => sum + cents(row.afterBRL), 0)).toBe(cents(result.totalAfter));
  });

  it("resume distância e alertas no agrupamento selecionado, cancelando desvios internos", () => {
    const rows = assets();
    rows[0].balance = 2000;
    rows[1].balance = 6000;
    const result = simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 0, mode: "contribution" });
    const byAsset = summarizeMetrics(result, rows, "asset");
    const byClass = summarizeMetrics(result, rows, "assetClass", groupTargets);
    expect(byAsset.distanceBefore).toBeCloseTo(0.475);
    expect(byClass.distanceBefore).toBeCloseTo(0.3);
    expect(byAsset.distanceAfter).toBeCloseTo(0.475);
    expect(byClass.distanceAfter).toBeCloseTo(0.3);
    expect(byAsset.before).toBe(3);
    expect(byClass.before).toBe(2);
  });

  it("conta no agrupamento as categorias com meta configurada e sem ativos", () => {
    const result = simulateAssetRebalance({ assets: assets(), dimension: "assetClass", targets: groupTargets, contribution: 0, mode: "full" });
    const metrics = summarizeMetrics(result, assets(), "productType", { CDB: 60, "Ações": 30, ETF: 10 });
    expect(metrics.distanceBefore).toBeCloseTo(0.2);
    expect(metrics.distanceAfter).toBeCloseTo(0.2);
    expect(metrics.before).toBe(3);
    expect(metrics.after).toBe(2);
  });
});

describe("intenção de saída", () => {
  it("mantém a preferência entre importações sem confundir vencimentos diferentes", () => {
    const first = { ...positions[0], maturity: "2030-01-01" };
    const next = { ...first, id: "novo-id", balance: 7000 };
    expect(rebalancePreferenceKey(first)).toBe(rebalancePreferenceKey(next));
    expect(rebalancePreferenceKey(first)).not.toBe(rebalancePreferenceKey({ ...first, maturity: "2031-01-01" }));
    expect(rebalancePreferenceKey({ name: "  CDB   BANCO A " })).toBe(rebalancePreferenceKey({ name: "cdb banco a" }));
  });

  it("mantém o caixa manual e o patrimônio ao bloquear destinos em saída", () => {
    const rows = assets();
    rows[0].intent = "exit";
    const result = simulateAssetRebalance({ assets: rows, dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "contribution", manualContributions: { CDI: 700 } });
    expect(result.remainingCash).toBe(300);
    expect(result.rows[0].tradeBRL).toBe(0);
    expect(result.rows.reduce((sum, row) => sum + cents(row.afterBRL), cents(result.remainingCash))).toBe(cents(result.totalAfter));
  });

  it.each(["asset", "assetClass", "productType"] as const)("não aporta em ativo em saída ao definir metas por %s", (dimension) => {
    const rows = assets();
    rows[0].intent = "exit";
    const targets = dimension === "productType" ? { CDB: 50, Ações: 50 } : groupTargets;
    const result = simulateAssetRebalance({ assets: rows, dimension, targets, contribution: 2000, mode: "contribution" });
    expect(result.rows[0].tradeBRL).toBe(0);
    expect(result.rows[0].targetPct).toBe(0);
    expect(result.rows[0].afterBRL).toBe(6000);
    expect(result.purchases).toBe(2000);
    expect(result.minimumContribution).toBeNull();
  });

  it("bloqueia até aporte manual direcionado ao ativo em saída", () => {
    const rows = assets();
    rows[0].intent = "exit";
    expect(() => simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 1000, mode: "contribution", manualContributions: { [rows[0].key]: 1 } })).toThrow(/saída.*aportes/);
  });

  it("redistribui aporte manual da classe apenas entre ativos que serão mantidos", () => {
    const rows = assets();
    rows[0].intent = "exit";
    const result = simulateAssetRebalance({ assets: rows, dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "contribution", manualContributions: { CDI: 1000 } });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([0, 1000, 0]);
  });

  it("não presume que a intenção de sair permite vender imediatamente", () => {
    const rows = assets();
    rows[0].intent = "exit";
    const result = simulateAssetRebalance({ assets: rows, dimension: "assetClass", targets: groupTargets, contribution: 2000, mode: "full" });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([0, 1000, 1000]);
    expect(result.rows[0].afterBRL).toBe(6000);
    expect(result.rows[0].targetPct).toBe(0);
    expect(result.rows[0].afterNeedsAction).toBe(true);
    expect(result.totalAfter).toBe(12000);
    expect(result.rows.reduce((sum, row) => sum + cents(row.afterBRL), 0)).toBe(1200000);
  });

  it("permite simular a venda somente após liberar o resgate no cenário", () => {
    const rows = assets();
    rows[0].intent = "exit";
    rows[0].allowExitSale = true;
    const result = simulateAssetRebalance({ assets: rows, dimension: "assetClass", targets: groupTargets, contribution: 2000, mode: "full" });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([-6000, 4000, 4000]);
    expect(result.rows[0].afterBRL).toBe(0);
    expect(result.purchases - result.sales).toBe(2000);
  });

  it("continua sem vender no modo aporte, mesmo com resgate liberado", () => {
    const rows = assets();
    rows[0].intent = "exit";
    rows[0].allowExitSale = true;
    const result = simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 1000, mode: "contribution" });
    expect(result.rows[0].tradeBRL).toBe(0);
    expect(result.sales).toBe(0);
  });

  it("pede um destino quando todos os ativos de uma classe estão em saída", () => {
    const rows = assets();
    rows[0].intent = "exit";
    rows[1].intent = "exit";
    expect(() => simulateAssetRebalance({ assets: rows, dimension: "assetClass", targets: groupTargets, contribution: 1000, mode: "contribution" })).toThrow(/CDI.*elegível/);
  });

  it("pede um destino em vez de aportar quando todos os ativos estão em saída", () => {
    const rows = assets().map((asset) => ({ ...asset, intent: "exit" as const }));
    expect(() => simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 1000, mode: "contribution" })).toThrow(/elegível/);
  });

  it("voltar a manter recupera a meta base sem destruir as preferências do cenário", () => {
    const rows = assets();
    rows[0].intent = "exit";
    simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 1000, mode: "contribution" });
    expect(rows[0].targetPct).toBe(37.5);
    rows[0].intent = "keep";
    const result = simulateAssetRebalance({ assets: rows, dimension: "asset", targets: {}, contribution: 1000, mode: "full" });
    expect(result.rows[0].targetPct).toBe(0.375);
  });
});

describe("simulateRebalance", () => {
  it("destina o aporte à categoria abaixo do alvo sem vender o excesso", () => {
    const result = simulateRebalance(base);
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([0, 2000]);
    expect(result.totalBefore).toBe(10000);
    expect(result.totalAfter).toBe(12000);
    expect(result.purchases).toBe(2000);
    expect(result.sales).toBe(0);
    expect(result.remainingCash).toBe(0);
    expect(result.distanceAfter).toBeLessThan(result.distanceBefore);
    expect(result.minimumContribution).toBe(6000);
  });

  it("distribui proporcionalmente aos déficits calculados sobre o total após aporte", () => {
    const result = simulateRebalance({
      ...base,
      categories: [
        { key: "A", balance: 8000, targetPct: 50 },
        { key: "B", balance: 1000, targetPct: 30 },
        { key: "C", balance: 1000, targetPct: 20 },
      ],
    });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([0, 1300, 700]);
  });

  it("atinge o alvo apenas com aporte quando há dinheiro suficiente", () => {
    const result = simulateRebalance({ ...base, contribution: 6000 });
    expect(result.rows.map((row) => row.afterBRL)).toEqual([8000, 8000]);
    expect(result.distanceAfter).toBe(0);
    expect(result.sales).toBe(0);
  });

  it("rebalanceia sem aporte usando o produto dos resgates", () => {
    const result = simulateRebalance({ ...base, contribution: 0, mode: "full" });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([-3000, 3000]);
    expect(result.purchases).toBe(result.sales);
    expect(result.totalAfter).toBe(result.totalBefore);
    expect(result.distanceAfter).toBe(0);
  });

  it("combina aporte e resgates sem contar o dinheiro duas vezes", () => {
    const result = simulateRebalance({ ...base, mode: "full" });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([-2000, 4000]);
    expect(result.purchases - result.sales).toBe(2000);
    expect(result.rows.map((row) => row.afterBRL)).toEqual([6000, 6000]);
  });

  it("aceita aportes manuais e inclui o caixa restante no denominador", () => {
    const result = simulateRebalance({ ...base, manualContributions: { Ações: 1500 } });
    expect(result.remainingCash).toBe(500);
    expect(result.rows[1].afterPct).toBeCloseTo(3500 / 12000);
    expect(result.rows.reduce((sum, row) => sum + row.afterBRL, result.remainingCash)).toBe(12000);
  });

  it("permite testar um aporte manual que piora a alocação", () => {
    const result = simulateRebalance({ ...base, manualContributions: { "Renda fixa": 2000 } });
    expect(result.distanceAfter).toBeGreaterThan(result.distanceBefore);
  });

  it("rejeita aportes manuais acima do orçamento", () => {
    expect(() => simulateRebalance({ ...base, manualContributions: { Ações: 2000.01 } })).toThrow(/orçamento/);
  });

  it("rejeita categorias manuais desconhecidas", () => {
    expect(() => simulateRebalance({ ...base, manualContributions: { Outra: 100 } })).toThrow(/categoria/);
  });

  it("informa quando alvo zero torna impossível rebalancear somente com aportes", () => {
    const result = simulateRebalance({
      ...base,
      categories: [
        { key: "Fora do alvo", balance: 100, targetPct: 0 },
        { key: "Alvo", balance: 900, targetPct: 100 },
      ],
    });
    expect(result.minimumContribution).toBeNull();
    expect(result.rows[0].tradeBRL).toBe(0);
    expect(result.rows[0].needsAction).toBe(true);
    const full = simulateRebalance({ ...base, categories: result.rows.map((row) => ({
      key: row.key, balance: row.currentBRL, targetPct: row.targetPct * 100,
    })), mode: "full" });
    expect(full.rows[0].afterBRL).toBe(0);
  });

  it("investe em categorias novas mesmo sem saldo inicial", () => {
    const result = simulateRebalance({
      ...base,
      categories: base.categories.map((row) => ({ ...row, balance: 0 })),
    });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([1000, 1000]);
    expect(result.minimumContribution).toBe(0);
    expect(result.distanceAfter).toBe(0);
  });

  it("mantém resultados finitos para carteira vazia sem aporte", () => {
    const result = simulateRebalance({
      ...base, contribution: 0,
      categories: base.categories.map((row) => ({ ...row, balance: 0 })),
    });
    expect(result.totalAfter).toBe(0);
    expect(result.distanceAfter).toBe(0);
    expect(result.rows.every((row) => row.afterPct === 0 && !row.needsAction)).toBe(true);
  });

  it("preserva cada centavo ao dividir valores e normalizar metas arredondadas", () => {
    for (const mode of ["contribution", "full"] as const) {
      const result = simulateRebalance({
        categories: ["A", "B", "C"].map((key) => ({ key, balance: 0, targetPct: 33.33 })),
        contribution: 100, mode,
      });
      expect(result.rows.map((row) => row.tradeBRL)).toEqual([33.34, 33.33, 33.33]);
      expect(cents(result.purchases)).toBe(10000);
      expect(result.remainingCash).toBe(0);
    }
  });

  it("não sugere operações para carteira já balanceada sem aporte", () => {
    const result = simulateRebalance({ ...base, contribution: 0, categories: [
      { key: "A", balance: 5000, targetPct: 50 },
      { key: "B", balance: 5000, targetPct: 50 },
    ] });
    expect(result.rows.every((row) => row.tradeBRL === 0 && !row.needsAction)).toBe(true);
    expect(result.minimumContribution).toBe(0);
  });

  it("concentra a sugestão de aporte nas categorias fora da tolerância", () => {
    const result = simulateRebalance({ ...base, contribution: 1000, categories: [
      { key: "Acima", balance: 6100, targetPct: 50 },
      { key: "Na meta", balance: 3000, targetPct: 30 },
      { key: "Abaixo", balance: 900, targetPct: 20 },
    ] });
    expect(result.rows.map((row) => row.needsAction)).toEqual([true, false, true]);
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([0, 0, 1000]);
  });

  it("aplica o aporte conforme as metas quando nada está fora da tolerância", () => {
    const result = simulateRebalance({ ...base, contribution: 1000, categories: [
      { key: "A", balance: 5000, targetPct: 50 },
      { key: "B", balance: 3000, targetPct: 30 },
      { key: "C", balance: 2000, targetPct: 20 },
    ] });
    expect(result.rows.map((row) => row.tradeBRL)).toEqual([500, 300, 200]);
    expect(result.rows.every((row) => !row.afterNeedsAction)).toBe(true);
  });

  it("preserva a tolerância relativa de 20% e o limite residual de 0,25%", () => {
    const result = simulateRebalance({ ...base, contribution: 0 });
    expect(result.rows.every((row) => row.needsAction)).toBe(true);
    const residual = simulateRebalance({ ...base, categories: [
      { key: "A", balance: 9990, targetPct: 100 },
      { key: "B", balance: 10, targetPct: 0 },
    ] });
    expect(residual.rows.every((row) => !row.needsAction)).toBe(true);
  });

  it.each([-1, NaN, Infinity])("rejeita aporte inválido %s", (contribution) => {
    expect(() => simulateRebalance({ ...base, contribution })).toThrow();
  });

  it.each([-1, NaN, Infinity])("rejeita saldo inválido %s", (balance) => {
    expect(() => simulateRebalance({ ...base, categories: [{ key: "A", balance, targetPct: 100 }] })).toThrow();
  });

  it.each([{}, { A: 90 }, { A: -10, B: 110 }, { A: NaN }, { A: Infinity }])("rejeita metas inválidas %s", (targets) => {
    expect(() => simulateRebalance({ ...base, categories: Object.entries(targets).map(([key, targetPct]) => ({
      key, targetPct: targetPct as number, balance: 100,
    })) })).toThrow(/metas/);
  });

  it("rejeita categorias duplicadas e valores fora da precisão monetária", () => {
    expect(() => simulateRebalance({ ...base, categories: [base.categories[0], base.categories[0]] })).toThrow(/duplicada/);
    expect(() => simulateRebalance({ ...base, contribution: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it("não modifica as categorias recebidas", () => {
    const categories = base.categories.map((row) => Object.freeze({ ...row }));
    expect(() => simulateRebalance({ ...base, categories })).not.toThrow();
    expect(categories).toEqual(base.categories);
  });

  it("conserva os recursos e nunca produz saldos negativos em múltiplos cenários", () => {
    for (let i = 1; i <= 100; i++) {
      for (const mode of ["contribution", "full"] as const) {
        const contribution = i * 13.37;
        const result = simulateRebalance({
          categories: [
            { key: "A", balance: i * 123.45, targetPct: 20 },
            { key: "B", balance: (101 - i) * 98.76, targetPct: 30 },
            { key: "C", balance: i * 0.03, targetPct: 50 },
          ], contribution, mode,
        });
        expect(result.rows.every((row) => row.afterBRL >= 0)).toBe(true);
        expect(result.rows.reduce((sum, row) => sum + cents(row.afterBRL), cents(result.remainingCash))).toBe(cents(result.totalAfter));
        expect(cents(result.purchases) - cents(result.sales) + cents(result.remainingCash)).toBe(cents(contribution));
        if (mode === "contribution") expect(result.sales).toBe(0);
        else expect(result.rows.every((row) => Math.abs(row.afterBRL - row.targetBRL) < 0.01)).toBe(true);
      }
    }
  });
});
