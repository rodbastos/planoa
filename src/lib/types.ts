export const ASSET_CLASSES = [
  "Pós-Fixado CDI",
  "Prefixado",
  "IPCA Médio",
  "IPCA Longo",
  "Renda Variável Global",
  "Renda Variável Brasil",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const PRODUCT_TYPES = [
  "Tesouro Direto",
  "Fundos de Renda Fixa",
  "Fundos de Renda Variável",
  "Fundos Multimercado",
  "ETF",
  "COE",
  "Ações",
  "Títulos Públicos",
  "Títulos Privados",
  "Previdência",
  "Outros",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export interface Position {
  id?: string;
  name: string;
  ticker?: string;
  /** Seção original da planilha: Ações, Tesouro Direto, Renda Fixa, COE, Fundos de Investimentos */
  sourceSection: string;
  assetClass: string;
  productType: string;
  balance: number;
  allocationPct: number;
  quantity?: number;
  avgPrice?: number;
  lastPrice?: number;
  appliedValue?: number;
  netBalance?: number;
  maturity?: string;
  applicationDate?: string;
  yieldText?: string;
  ir?: number;
  iof?: number;
  /** chave estável para regras de classificação (ticker ou nome normalizado) */
  instrumentKey?: string;
}

export interface ImportMeta {
  id: string;
  uploadedAt: number;
  /** data de referência do relatório (cabeçalho da planilha), se extraída */
  referenceDate?: number;
  fileName: string;
  patrimonio: number;
  totalInvestido: number;
  saldoDisponivel: number;
  positionCount: number;
}

export interface ParsedSpreadsheet {
  patrimonio: number;
  totalInvestido: number;
  saldoDisponivel: number;
  saldoProjetado: number;
  /** data de referência do relatório (ex.: "Conta: 123 | 03/10/2026, 05:21") */
  referenceDate?: number;
  positions: Position[];
  warnings: string[];
}

export interface InstrumentRule {
  assetClass?: string;
  productType?: string;
}

export interface Targets {
  byAssetClass: Record<string, number>;
  byProductType: Record<string, number>;
}

export interface AllocationSlice {
  key: string;
  balance: number;
  pct: number;
}

/** linha anual do relatório de patrimônio da XP (CSV) */
export interface WealthYear {
  year: number;
  /** patrimônio no início do ano */
  initial: number;
  /** movimentações do ano: aportes − resgates */
  flows: number;
  /** IR + IOF pagos (negativo) */
  taxes: number;
  /** patrimônio no fim do ano */
  final: number;
  /** rendimento do ano em R$ */
  returns: number;
  /** rentabilidade do ano (fração, ex.: 0.0958) */
  returnPct: number;
}

export interface RetirementPlan {
  /** rentabilidade real esperada, em % ao ano (ex.: 7) */
  realReturnPct: number;
  currentAge: number;
  /** idade em que começam os resgates */
  retirementAge: number;
  initialValue: number;
  monthlyContribution: number;
  /** renda passiva mensal desejada na fase de resgate */
  desiredMonthlyIncome: number;
}
