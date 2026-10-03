/** Paleta Plano A + extensões harmônicas para categorias */

const PALETTE = [
  "#0B2033", // navy
  "#258A84", // teal
  "#568DB0", // sky
  "#45B0A8", // teal claro
  "#8FB6CE", // sky claro
  "#16456E", // navy médio
  "#6EC6B8", // teal pastel
  "#3E6E8E", // sky escuro
  "#A5CDE0", // sky pastel
  "#123A55", // navy profundo
];

const CLASS_COLORS: Record<string, string> = {
  "Inflação": "#568DB0",
  "Pós-Fixado CDI": "#258A84",
  "Prefixado": "#0B2033",
  "Renda Variável Global": "#45B0A8",
  "Renda Variável Brasil": "#16456E",
};

const assigned = new Map<string, string>();
let cursor = 0;

export function categoryColor(key: string): string {
  if (CLASS_COLORS[key]) return CLASS_COLORS[key];
  if (!assigned.has(key)) {
    assigned.set(key, PALETTE[cursor % PALETTE.length]);
    cursor++;
  }
  return assigned.get(key)!;
}

export const CHART = {
  current: "#258A84",
  target: "#0B2033",
  grid: "rgba(120,140,155,0.25)",
};
