import { describe, expect, it } from "vitest";
import { parseWealthCsv } from "../wealth-csv";

const CSV = `Ano,Patrimônio inicial,Movimentações,IR Pago + IRRF,IOF Pago,Patrimônio final,Rendimento,Rentabilidade,Rentabilidade (% CDI)
2026,1150009.87,35840.98,-15958.46,0.00,1276467.38,106574.98,9.58%,91.67%
2025,758495.08,274692.61,-6567.00,-0.03,1150009.87,123389.18,14.86%,103.80%
2017,0.00,85004.98,-374.96,0.00,93679.55,9049.53,10.96%,122.06%
Total,0.00,899243.88,-45193.29,-0.03,1276467.38,422416.79,131.90%,98.07%
`;

describe("parseWealthCsv", () => {
  it("extrai os campos de cada ano e ordena", () => {
    const years = parseWealthCsv(CSV);
    expect(years.map((y) => y.year)).toEqual([2017, 2025, 2026]);

    const y2025 = years[1];
    expect(y2025.initial).toBeCloseTo(758_495.08, 2);
    expect(y2025.flows).toBeCloseTo(274_692.61, 2);
    expect(y2025.taxes).toBeCloseTo(-6_567.03, 2); // IR + IOF
    expect(y2025.final).toBeCloseTo(1_150_009.87, 2);
    expect(y2025.returns).toBeCloseTo(123_389.18, 2);
    expect(y2025.returnPct).toBeCloseTo(0.1486, 4);
  });

  it("ignora a linha de Total e linhas inválidas", () => {
    const years = parseWealthCsv(CSV);
    expect(years).toHaveLength(3);
    expect(parseWealthCsv("")).toEqual([]);
    expect(parseWealthCsv("lixo\nTotal,0,0,0,0,0,0,0%,0%")).toEqual([]);
  });
});
