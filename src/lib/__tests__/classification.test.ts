import { describe, expect, it } from "vitest";
import { normalizeAssetClass, refineIpcaClass } from "../classification";

const isoInYears = (y: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + y);
  return d.toISOString().slice(0, 10);
};

describe("divisão IPCA Longo/Médio", () => {
  it("respeita dicas no rótulo da planilha", () => {
    expect(normalizeAssetClass("IPCA Longo")).toBe("IPCA Longo");
    expect(normalizeAssetClass("Inflação Médio")).toBe("IPCA Médio");
    expect(normalizeAssetClass("Inflação Curto")).toBe("IPCA Médio");
    expect(normalizeAssetClass("Inflação")).toBe("IPCA");
  });

  it("refina IPCA genérico pelo vencimento", () => {
    expect(refineIpcaClass("IPCA", isoInYears(8))).toBe("IPCA Longo");
    expect(refineIpcaClass("IPCA", isoInYears(2))).toBe("IPCA Médio");
    expect(refineIpcaClass("IPCA")).toBe("IPCA Longo");
    expect(refineIpcaClass("Prefixado", isoInYears(8))).toBe("Prefixado");
  });
});
