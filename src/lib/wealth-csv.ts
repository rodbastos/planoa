import type { WealthYear } from "./types";

const num = (s: string | undefined): number => {
  const v = parseFloat(String(s ?? "").replace(/[""\s]/g, ""));
  return Number.isNaN(v) ? 0 : v;
};

const pct = (s: string | undefined): number =>
  num(String(s ?? "").replace("%", "")) / 100;

/**
 * Faz o parse do CSV anual de patrimônio da XP:
 * "Ano, Patrimônio inicial, Movimentações, IR Pago + IRRF, IOF Pago,
 *  Patrimônio final, Rendimento, Rentabilidade, Rentabilidade (% CDI)"
 *
 * Ignora a linha de "Total" e ordena por ano.
 */
export function parseWealthCsv(text: string): WealthYear[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const years: WealthYear[] = [];
  for (const line of lines) {
    const cells = line.split(",");
    const year = Number(String(cells[0] ?? "").trim());
    if (!Number.isInteger(year) || year < 1900 || year > 2200) continue;
    years.push({
      year,
      initial: num(cells[1]),
      flows: num(cells[2]),
      taxes: num(cells[3]) + num(cells[4]),
      final: num(cells[5]),
      returns: num(cells[6]),
      returnPct: pct(cells[7]),
    });
  }
  return years.sort((a, b) => a.year - b.year);
}
