export const ASSET_CLASSES = [
  "Inflação",
  "Pós-Fixado CDI",
  "Prefixado",
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
  "Renda Fixa Direta",
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
