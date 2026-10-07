import * as XLSX from "xlsx";
import type { ParsedSpreadsheet, Position } from "./types";
import {
  parseBRL,
  parseDateBR,
  parseDateTimeBR,
  parsePercent,
  parseQuantity,
} from "./format";
import { guessProductType, instrumentKey, normalizeAssetClass, refineIpcaClass } from "./classification";

/** remove acentos, minúsculas, só alfanumérico */
function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** seções de produto conhecidas do relatório da XP */
const KNOWN_SECTIONS = new Set([
  "acoes",
  "tesourodireto",
  "rendafixa",
  "coe",
  "fundosdeinvestimentos",
  "fundosdeinvestimento",
  "previdencia",
  "fundosimobiliarios",
  "derivativos",
  "contacorrente",
]);

/** tokens que identificam uma linha de cabeçalho de colunas */
const HEADER_TOKENS = new Set([
  "saldo",
  "saldoamercado",
  "saldoliquido",
  "alocacao",
  "rentabilidade",
  "rentabilidadeamercado",
  "rendimentobruto",
  "precomedio",
  "ultimopreco",
  "ultimoprecor",
  "qtdtotal",
  "quantidade",
  "disponivel",
  "vencimento",
  "datavencimento",
  "dataaplicacao",
  "valoraplicado",
  "valoraplicadooriginal",
  "precounitario",
  "ir",
  "iof",
]);

const CLASS_RE = /^(\d+[.,]\d+)\s*%\s*\|\s*(.+)$/;

type Rows = unknown[][];

function isBlankRow(row: Rows[number]): boolean {
  return row.every((c) => c === null || c === undefined || String(c).trim() === "");
}

function findTotalsRow(rows: Rows): {
  patrimonio: number;
  totalInvestido: number;
  saldoDisponivel: number;
  saldoProjetado: number;
} {
  for (let i = 0; i < rows.length; i++) {
    const labels = rows[i];
    if (labels.some((c) => norm(c).includes("patrimonio"))) {
      const vals = rows[i + 1] ?? [];
      // localiza a coluna pelo rótulo; fallback na posição do layout XP
      const col = (label: string, fallback: number) => {
        const idx = labels.findIndex((c) => norm(c).includes(label));
        return idx >= 0 ? idx : fallback;
      };
      // "Disponível" vem da célula "Saldo projetado" (inclui liquidações pendentes)
      const projetado = col("saldoprojetado", col("saldodisponivel", 3));
      return {
        patrimonio: parseBRL(vals[col("patrimonio", 0)]) ?? 0,
        totalInvestido: parseBRL(vals[col("totalinvestido", 1)]) ?? 0,
        saldoDisponivel: parseBRL(vals[projetado]) ?? 0,
        saldoProjetado: parseBRL(vals[projetado]) ?? 0,
      };
    }
  }
  return { patrimonio: 0, totalInvestido: 0, saldoDisponivel: 0, saldoProjetado: 0 };
}

/**
 * Faz o parse do relatório "Posição Detalhada" (XP Investimentos).
 * Detecta dinamicamente seções de produto, sub-seções de classe de ativo
 * e o layout de colunas de cada bloco.
 */
export function parseSpreadsheet(data: ArrayBuffer | Uint8Array): ParsedSpreadsheet {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
  }) as Rows;

  const totals = findTotalsRow(rows);
  const positions: Position[] = [];
  const warnings: string[] = [];

  // data de referência do relatório, no cabeçalho (ex.: "Conta: 2045900 |
  // 03/10/2026, 05:21"). Em planilhas antigas há "Data da consulta" e
  // "Data da Posição Histórica" — nesse caso vale a última data da célula.
  let referenceDate: number | undefined;
  scan: for (let r = 0; r < Math.min(rows.length, 6); r++) {
    for (const c of rows[r] ?? []) {
      if (typeof c !== "string") continue;
      if (norm(c).includes("posicaohistorica")) {
        const dates = c.match(/\d{2}\/\d{2}\/\d{4}/g);
        const t = parseDateTimeBR(dates?.[dates.length - 1]);
        if (t !== undefined) {
          referenceDate = t;
          break scan;
        }
      }
      const t = parseDateTimeBR(c);
      if (t !== undefined && referenceDate === undefined) referenceDate = t;
    }
  }

  let currentSection: string | undefined;
  let currentClassRaw: string | undefined;
  /** colIndex -> header normalizado */
  let headerMap: Map<number, string> | undefined;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || isBlankRow(row)) continue;

    const first = String(row[0] ?? "").trim();
    const firstNorm = norm(row[0]);

    // linha de classe de ativo: "12,1% | Renda Variável Global"
    // (no relatório da XP os cabeçalhos de coluna vêm na MESMA linha)
    const classMatch = first.match(CLASS_RE);
    if (classMatch) {
      currentClassRaw = classMatch[2].trim();
      const hdrs = row
        .map((c, idx) => ({ idx, n: norm(c) }))
        .filter((t) => t.idx > 0 && HEADER_TOKENS.has(t.n));
      headerMap = hdrs.length >= 2 ? new Map(hdrs.map((t) => [t.idx, t.n])) : undefined;
      continue;
    }

    // linha de cabeçalho de colunas (>= 2 tokens conhecidos)
    const tokens = row
      .map((c, idx) => ({ idx, n: norm(c) }))
      .filter((t) => HEADER_TOKENS.has(t.n));
    if (tokens.length >= 2) {
      headerMap = new Map(tokens.map((t) => [t.idx, t.n]));
      continue;
    }

    // linha de seção de produto: nome conhecido, ou "texto único + um valor R$"
    const nonEmptyCells = row
      .map((c, idx) => ({ idx, v: c }))
      .filter((c) => c.v !== null && String(c.v).trim() !== "");
    const currencyCells = nonEmptyCells.filter(
      (c) => c.idx > 0 && parseBRL(c.v) !== undefined,
    );
    if (
      first &&
      !classMatch &&
      (KNOWN_SECTIONS.has(firstNorm) ||
        (nonEmptyCells.length === 2 && currencyCells.length === 1))
    ) {
      currentSection = first;
      currentClassRaw = undefined;
      headerMap = undefined;
      continue;
    }

    // linha de dados: exige seção + classe + cabeçalho já detectados
    if (first && currentSection && headerMap) {
      const pos: Position = {
        name: first,
        sourceSection: currentSection,
        assetClass: normalizeAssetClass(currentClassRaw ?? "Outros"),
        productType: "Outros",
        balance: 0,
        allocationPct: 0,
      };

      if (/^[A-Z]{3,4}\d{1,2}[A-Z]?$/.test(first)) pos.ticker = first;

      headerMap.forEach((h, idx) => {
        const v = row[idx];
        switch (h) {
          case "saldo":
          case "saldoamercado":
            pos.balance = parseBRL(v) ?? 0;
            break;
          case "alocacao":
            pos.allocationPct = parsePercent(v) ?? 0;
            break;
          case "rentabilidade":
          case "rentabilidadeamercado":
            if (v !== null && String(v).trim() !== "")
              pos.yieldText = String(v).trim();
            break;
          case "precomedio":
            pos.avgPrice = parseBRL(v);
            break;
          case "ultimopreco":
          case "ultimoprecor":
          case "precounitario":
            if (pos.lastPrice === undefined) pos.lastPrice = parseBRL(v);
            break;
          case "qtdtotal":
          case "quantidade":
            pos.quantity = parseQuantity(v);
            break;
          case "valoraplicado":
            pos.appliedValue = parseBRL(v);
            break;
          case "valoraplicadooriginal":
            if (pos.appliedValue === undefined) pos.appliedValue = parseBRL(v);
            break;
          case "vencimento":
          case "datavencimento":
            pos.maturity = parseDateBR(v);
            break;
          case "dataaplicacao":
            pos.applicationDate = parseDateBR(v);
            break;
          case "saldoliquido":
            pos.netBalance = parseBRL(v);
            break;
          case "ir":
            pos.ir = parseBRL(v);
            break;
          case "iof":
            pos.iof = parseBRL(v);
            break;
          default:
            break;
        }
      });

      if (!currentClassRaw) {
        warnings.push(`Linha ${r + 1}: "${first}" sem classe de ativo detectada`);
      }
      if (pos.balance === 0 && parseBRL(row[1]) === undefined) {
        warnings.push(`Linha ${r + 1}: "${first}" sem saldo reconhecido`);
      }

      pos.assetClass = refineIpcaClass(pos.assetClass, pos.maturity);
      pos.productType = guessProductType(pos);
      positions.push(pos);
    } else if (first && !currentSection && r > 4) {
      // texto solto fora de seção conhecida — provável seção nova não catalogada
      if (!KNOWN_SECTIONS.has(firstNorm) && currencyCells.length === 0) {
        warnings.push(`Linha ${r + 1}: possível seção não reconhecida "${first}"`);
      }
    }
  }

  // chave estável por instrumento (para overrides de classificação)
  for (const p of positions) p.instrumentKey = instrumentKey(p);

  return { ...totals, referenceDate, positions, warnings };
}
