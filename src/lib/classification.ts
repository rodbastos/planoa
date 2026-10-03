import type { InstrumentRule, Position } from "./types";

function deaccent(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Normaliza a classe vinda da planilha para a taxonomia do app */
export function normalizeAssetClass(raw: string): string {
  const n = deaccent(raw);
  if (n.includes("inflac")) return "Inflação";
  if (n.includes("pos-fixado") || n.includes("pos fixado") || n === "posfixado")
    return "Pós-Fixado CDI";
  if (n.includes("prefixado") || n.includes("pre-fixado")) return "Prefixado";
  if (n.includes("global") || n.includes("exterior") || n.includes("internacional"))
    return "Renda Variável Global";
  if (n.includes("brasil") || n.includes("variavel"))
    return "Renda Variável Brasil";
  if (n.includes("multimercado")) return "Multimercado";
  if (n.includes("imobili")) return "Renda Variável Brasil";
  return raw.trim() || "Outros";
}

/** Chave estável do instrumento para regras de classificação */
export function instrumentKey(p: Pick<Position, "ticker" | "name">): string {
  const base = p.ticker ?? p.name;
  return base.trim().replace(/\s+/g, " ").toUpperCase();
}

const FUND_RV_RE = /\b(FIA|A[CÇ][OÕ]ES|EQUITIES|STOCK)\b/i;
const FUND_MM_RE = /\b(FIM|MULTIMERCADO|MULTI)\b/i;
const FUND_PREV_RE = /\b(PREV|PREVID[EÊ]NCIA|PGBL|VGBL|FMP)\b/i;

/** Chute inicial de tipo de produto baseado na seção da planilha + nome/ticker */
export function guessProductType(
  p: Pick<Position, "sourceSection" | "ticker" | "name">,
): string {
  const section = deaccent(p.sourceSection).replace(/[^a-z0-9]/g, "");
  const name = p.name.toUpperCase();

  switch (section) {
    case "acoes":
      // terminados em 11: maioria ETF na B3 (FII também — corrigível via override)
      if (p.ticker && /11B?$/.test(p.ticker)) return "ETF";
      if (p.ticker && /(31|32|33|34|35|39)B?$/.test(p.ticker)) return "Ações"; // BDRs
      return "Ações";
    case "tesourodireto":
      return "Tesouro Direto";
    case "rendafixa":
      return "Renda Fixa Direta";
    case "coe":
      return "COE";
    case "fundosdeinvestimentos":
    case "fundosdeinvestimento":
      if (FUND_PREV_RE.test(name)) return "Previdência";
      if (FUND_RV_RE.test(name)) return "Fundos de Renda Variável";
      if (FUND_MM_RE.test(name)) return "Fundos Multimercado";
      return "Fundos de Renda Fixa";
    case "fundosimobiliarios":
      return "Fundos de Renda Variável";
    case "previdencia":
      return "Previdência";
    default:
      return "Outros";
  }
}

/** Aplica overrides do usuário sobre a classificação automática */
export function applyRules(
  positions: Position[],
  rules: Record<string, InstrumentRule>,
): Position[] {
  return positions.map((p) => {
    const key = p.instrumentKey ?? instrumentKey(p);
    const rule = rules[key];
    if (!rule) return p;
    return {
      ...p,
      assetClass: rule.assetClass ?? p.assetClass,
      productType: rule.productType ?? p.productType,
    };
  });
}
