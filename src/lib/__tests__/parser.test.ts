import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpreadsheet } from "../xlsx-parser";
import { groupBy, totalBalance } from "../allocation";

const buf = readFileSync(
  resolve(__dirname, "../../../docs/PosicaoDetalhada (2).xlsx"),
);
const parsed = parseSpreadsheet(new Uint8Array(buf));

describe("parser da Posição Detalhada (XP)", () => {
  it("lê os totais do cabeçalho", () => {
    expect(parsed.patrimonio).toBeCloseTo(1_281_271.32, 0);
    expect(parsed.totalInvestido).toBeCloseTo(1_280_655.71, 0);
    expect(parsed.saldoDisponivel).toBeCloseTo(615.61, 1);
  });

  it("extrai todas as posições", () => {
    // 6 B3 + 6 Tesouro + 15 Renda Fixa + 5 COE + 4 Fundos
    expect(parsed.positions).toHaveLength(36);
  });

  it("normaliza classes de ativo para a taxonomia do app", () => {
    const classes = new Set(parsed.positions.map((p) => p.assetClass));
    expect(classes.has("Pós-Fixado CDI")).toBe(true);
    expect(classes.has("Inflação")).toBe(true);
    expect(classes.has("Prefixado")).toBe(true);
    expect(classes.has("Renda Variável Global")).toBe(true);
    expect(classes.has("Renda Variável Brasil")).toBe(true);
    // nenhum "Pós-Fixado" cru deve sobrar
    expect([...classes].every((c) => c !== "Pós-Fixado")).toBe(true);
  });

  it("classifica tipos de produto corretamente", () => {
    const byName = new Map(parsed.positions.map((p) => [p.name, p]));
    expect(byName.get("VWRA11")?.productType).toBe("ETF");
    expect(byName.get("CDIB11")?.productType).toBe("ETF");
    expect(byName.get("NTNB PRINC mai/2029")?.productType).toBe("Tesouro Direto");
    expect(byName.get("CDB BTG PACTUAL - JUL/2027")?.productType).toBe(
      "Renda Fixa Direta",
    );
    expect(
      byName.get("XP Bolsa Americana - Taxa Fixa ou Alta Ilimitada - 5y - 29.06.2022")
        ?.productType,
    ).toBe("COE");
    expect(byName.get("Trend DI FIC RF Simples RL")?.productType).toBe(
      "Fundos de Renda Fixa",
    );
    expect(byName.get("First Trust Megatrend FIA RL")?.productType).toBe(
      "Fundos de Renda Variável",
    );
  });

  it("lê saldo e quantidade das posições", () => {
    const vwra = parsed.positions.find((p) => p.name === "VWRA11")!;
    expect(vwra.balance).toBeCloseTo(125_927.7, 1);
    expect(vwra.quantity).toBe(1090);
    expect(vwra.avgPrice).toBeCloseTo(113.59, 2);
    expect(vwra.lastPrice).toBeCloseTo(115.53, 2);
  });

  it("lê vencimento em formato ISO", () => {
    const ntnb = parsed.positions.find((p) => p.name === "NTNB PRINC mai/2029")!;
    expect(ntnb.maturity).toBe("2029-05-15");
  });

  it("soma dos saldos é próxima do patrimônio", () => {
    const total = totalBalance(parsed.positions);
    // posições somam o total investido à mercado (≈ patrimônio - disponível)
    expect(Math.abs(total - (parsed.patrimonio - parsed.saldoDisponivel))).toBeLessThan(
      parsed.patrimonio * 0.01,
    );
  });

  it("distribui posições entre as 5 classes", () => {
    const slices = groupBy(parsed.positions, "assetClass");
    expect(slices.length).toBe(5);
    const total = slices.reduce((a, s) => a + s.pct, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
