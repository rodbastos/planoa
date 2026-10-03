import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ASSET_CLASSES,
  PRODUCT_TYPES,
  type ImportMeta,
  type Position,
  type RetirementPlan,
  type Targets,
} from "../../src/lib/types";
import { compareWithTargets, groupBy, totalBalance } from "../../src/lib/allocation";
import {
  coastFire,
  dynamicsFromImports,
  dynamicsFromWealth,
  simulateEstimated,
  simulateRetirement,
} from "../../src/lib/retirement";
import { parseWealthCsv } from "../../src/lib/wealth-csv";
import { applyRules, instrumentKey } from "../../src/lib/classification";
import { parseSpreadsheet } from "../../src/lib/xlsx-parser";
import * as store from "./db";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (e: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: `Erro: ${e instanceof Error ? e.message : String(e)}`,
    },
  ],
  isError: true as const,
});

const importIdArg = {
  importId: z
    .string()
    .optional()
    .describe("ID do snapshot (ver list_snapshots). Omitido = o de data de referência mais recente."),
};

async function resolveImport(uid: string, importId?: string) {
  const meta = importId
    ? await store.getImport(uid, importId)
    : await store.getCurrentImport(uid);
  if (!meta)
    throw new Error(
      importId
        ? `Snapshot "${importId}" não encontrado.`
        : "Nenhuma importação encontrada. Use upload_current_allocation primeiro.",
    );
  return meta;
}

const metaSummary = (m: ImportMeta) => ({
  importId: m.id,
  fileName: m.fileName,
  uploadedAt: new Date(m.uploadedAt).toISOString(),
  referenceDate: m.referenceDate
    ? new Date(m.referenceDate).toISOString()
    : undefined,
  patrimonio: m.patrimonio,
  totalInvestido: m.totalInvestido,
  saldoDisponivel: m.saldoDisponivel,
  positionCount: m.positionCount,
});

export function createServer(boundUid?: string): McpServer {
  // multi-tenant: quando o request HTTP chega com uma chave de usuário, o
  // servidor inteiro fica "bound" àquele uid — nenhuma tool escapa dele.
  // Sem boundUid (stdio), cai no uid admin do .env.
  const resolveUid = () => boundUid ?? store.getUid();
  const server = new McpServer({ name: "alloca", version: "0.1.0" });

  // =========================================================================
  // READ
  // =========================================================================

  server.registerTool(
    "list_snapshots",
    {
      description:
        "Lista todos os snapshots (importações da planilha de posição) do usuário, do mais recente ao mais antigo, com totais de patrimônio, investido e número de posições.",
      inputSchema: {},
    },
    async () => {
      try {
        const uid = await resolveUid();
        const imports = await store.listImports(uid);
        return ok({ count: imports.length, snapshots: imports.map(metaSummary) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_portfolio_status",
    {
      description:
        "Status atual da carteira: o snapshot com a data de referência mais recente (extraída do relatório, não a data de upload). Retorna patrimônio, investido, saldo disponível, rentabilidade, número de posições e a alocação resumida por classe de ativo.",
      inputSchema: {},
    },
    async () => {
      try {
        const uid = await resolveUid();
        const meta = await store.getCurrentImport(uid);
        if (!meta)
          throw new Error(
            "Nenhuma importação encontrada. Use upload_current_allocation primeiro.",
          );
        const positions = await store.getPositions(uid, meta.id);
        const gain = meta.patrimonio - meta.totalInvestido;
        return ok({
          snapshot: metaSummary(meta),
          dataReferencia: meta.referenceDate
            ? new Date(meta.referenceDate).toISOString()
            : null,
          gainBRL: gain,
          returnPct:
            meta.totalInvestido > 0 ? gain / meta.totalInvestido : null,
          allocationByAssetClass: groupBy(positions, "assetClass"),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_positions",
    {
      description:
        "Retorna todas as posições de um snapshot: nome, ticker, classe de ativo, tipo de produto, saldo, % de alocação, quantidade, preços, rentabilidade e vencimento.",
      inputSchema: { ...importIdArg },
    },
    async ({ importId }) => {
      try {
        const uid = await resolveUid();
        const meta = await resolveImport(uid, importId);
        const positions = await store.getPositions(uid, meta.id);
        return ok({
          snapshot: metaSummary(meta),
          positions: positions.sort(
            (a, b) => (b.balance ?? 0) - (a.balance ?? 0),
          ),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_asset_allocation",
    {
      description:
        "Alocação atual da carteira agregada por classe de ativo e/ou tipo de produto (R$ e %), com comparação contra a carteira alvo quando definida.",
      inputSchema: {
        ...importIdArg,
        groupBy: z
          .enum(["assetClass", "productType", "both"])
          .default("both")
          .describe("Dimensão de agregação"),
      },
    },
    async ({ importId, groupBy: dim }) => {
      try {
        const uid = await resolveUid();
        const meta = await resolveImport(uid, importId);
        const positions = await store.getPositions(uid, meta.id);
        const targets = await store.getTargets(uid);
        const total = totalBalance(positions);

        const section = (key: "assetClass" | "productType") => ({
          slices: groupBy(positions, key),
          vsTarget: targets
            ? compareWithTargets(
                positions,
                key === "assetClass"
                  ? targets.byAssetClass
                  : targets.byProductType,
                key,
                key === "assetClass" ? ASSET_CLASSES : PRODUCT_TYPES,
              )
            : undefined,
        });

        return ok({
          snapshot: metaSummary(meta),
          totalBalance: total,
          byAssetClass: dim !== "productType" ? section("assetClass") : undefined,
          byProductType: dim !== "assetClass" ? section("productType") : undefined,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_target_allocation",
    {
      description:
        "Retorna a carteira alvo (alocação ideal em %) definida pelo usuário, por classe de ativo e por tipo de produto.",
      inputSchema: {},
    },
    async () => {
      try {
        const uid = await resolveUid();
        const targets = await store.getTargets(uid);
        if (!targets)
          return ok({ targets: null, message: "Carteira alvo ainda não definida." });
        return ok({ targets });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_performance",
    {
      description:
        "Rentabilidade: patrimônio vs total investido do snapshot (ganho em R$ e %), rentabilidade individual de cada posição e evolução do patrimônio entre snapshots.",
      inputSchema: { ...importIdArg },
    },
    async ({ importId }) => {
      try {
        const uid = await resolveUid();
        const meta = await resolveImport(uid, importId);
        const positions = await store.getPositions(uid, meta.id);
        const imports = await store.listImports(uid);

        const gain = meta.patrimonio - meta.totalInvestido;
        const yields = positions
          .filter((p) => p.yieldText)
          .map((p) => ({
            name: p.name,
            ticker: p.ticker,
            balance: p.balance,
            yield: p.yieldText,
          }));

        return ok({
          snapshot: metaSummary(meta),
          gainBRL: gain,
          returnPct: meta.totalInvestido > 0 ? gain / meta.totalInvestido : null,
          positionYields: yields,
          snapshotTrend: [...imports]
            .sort((a, b) => a.uploadedAt - b.uploadedAt)
            .map((m) => ({
              importId: m.id,
              date: new Date(m.referenceDate ?? m.uploadedAt).toISOString(),
              patrimonio: m.patrimonio,
              totalInvestido: m.totalInvestido,
            })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_maturities",
    {
      description:
        "Vencimentos da carteira: posições com data de vencimento, ordenadas da mais próxima à mais distante, com dias restantes.",
      inputSchema: {
        ...importIdArg,
        withinDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Filtra apenas vencimentos nos próximos N dias"),
      },
    },
    async ({ importId, withinDays }) => {
      try {
        const uid = await resolveUid();
        const meta = await resolveImport(uid, importId);
        const positions = await store.getPositions(uid, meta.id);
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;

        const rows = positions
          .filter((p) => p.maturity && !Number.isNaN(Date.parse(p.maturity)))
          .map((p) => ({
            name: p.name,
            ticker: p.ticker,
            assetClass: p.assetClass,
            productType: p.productType,
            balance: p.balance,
            maturity: p.maturity,
            daysToMaturity: Math.round((Date.parse(p.maturity!) - now) / DAY),
          }))
          .filter((r) => withinDays === undefined || r.daysToMaturity <= withinDays)
          .sort((a, b) => a.daysToMaturity - b.daysToMaturity);

        return ok({
          snapshot: metaSummary(meta),
          count: rows.length,
          maturities: rows,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_wealth_history",
    {
      description:
        "Histórico patrimonial anual (do CSV da XP): patrimônio inicial/final, movimentações, impostos, rendimento e rentabilidade por ano.",
      inputSchema: {},
    },
    async () => {
      try {
        const uid = await resolveUid();
        const years = await store.getWealth(uid);
        return ok({ count: years.length, years });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_retirement_plan",
    {
      description:
        "Parâmetros do plano de aposentadoria: rentabilidade nominal, inflação, idades, aporte mensal e renda desejada.",
      inputSchema: {},
    },
    async () => {
      try {
        const uid = await resolveUid();
        const plan = await store.getRetirement(uid);
        if (!plan)
          return ok({
            plan: null,
            message: "Plano de aposentadoria ainda não definido.",
          });
        return ok({ plan });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "run_retirement_simulation",
    {
      description:
        "Roda a simulação de aposentadoria com o plano salvo (ou overrides): projeção de patrimônio em termos reais, patrimônio acumulado na aposentadoria, taxa de retirada, idade de esgotamento e Coast FIRE. Quando há histórico anual, inclui a trajetória estimada a partir dos dados observados.",
      inputSchema: {
        overrides: z
          .object({
            nominalReturnPct: z.number().optional(),
            inflationPct: z.number().optional(),
            currentAge: z.number().optional(),
            retirementAge: z.number().optional(),
            initialValue: z.number().optional(),
            monthlyContribution: z.number().optional(),
            desiredMonthlyIncome: z.number().optional(),
            lifeExpectancy: z.number().optional(),
          })
          .optional()
          .describe("Sobrescreve campos do plano salvo só para esta simulação"),
      },
    },
    async ({ overrides }) => {
      try {
        const uid = await resolveUid();
        const saved = await store.getRetirement(uid);
        const plan = { ...saved, ...overrides } as RetirementPlan;
        if (!plan.nominalReturnPct || plan.currentAge === undefined)
          throw new Error(
            "Plano de aposentadoria incompleto — defina-o no app ou passe todos os campos em overrides.",
          );

        const result = simulateRetirement(plan);
        const coast = coastFire(plan);

        // trajetória estimada a partir do histórico observado
        let estimated: unknown;
        const years = await store.getWealth(uid);
        const imports = await store.listImports(uid);
        const latest = imports[0];
        if (latest) {
          const anchor = {
            date: latest.referenceDate ?? latest.uploadedAt,
            patrimonio: latest.patrimonio,
          };
          const dyn =
            years.length > 0
              ? dynamicsFromWealth(years, plan.inflationPct)
              : dynamicsFromImports(
                  imports.map((m) => ({
                    date: m.referenceDate ?? m.uploadedAt,
                    patrimonio: m.patrimonio,
                  })),
                );
          if (dyn) estimated = simulateEstimated(anchor, dyn, plan);
        }

        return ok({
          plan,
          simulation: {
            accumulatedAtRetirement: result.accumulated,
            annualWithdrawalRate: result.annualWithdrawalRate,
            depletionAge: result.depletionAge,
            points: result.points,
          },
          coastFire: coast,
          observedTrajectory: estimated,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // =========================================================================
  // WRITE
  // =========================================================================

  server.registerTool(
    "set_target_allocation",
    {
      description:
        "Define a carteira alvo. Cada mapa enviado substitui o correspondente inteiro e deve somar 100 (%). Chaves ideais: classes " +
        ASSET_CLASSES.join(", ") +
        " | tipos: " +
        PRODUCT_TYPES.join(", "),
      inputSchema: {
        byAssetClass: z
          .record(z.number())
          .optional()
          .describe("% alvo por classe de ativo (soma = 100)"),
        byProductType: z
          .record(z.number())
          .optional()
          .describe("% alvo por tipo de produto (soma = 100)"),
      },
    },
    async ({ byAssetClass, byProductType }) => {
      try {
        if (!byAssetClass && !byProductType)
          throw new Error("Informe byAssetClass e/ou byProductType.");
        for (const [name, map] of [
          ["byAssetClass", byAssetClass],
          ["byProductType", byProductType],
        ] as const) {
          if (!map) continue;
          const sum = Object.values(map).reduce((a, b) => a + b, 0);
          if (Math.abs(sum - 100) > 0.01)
            throw new Error(`${name} deve somar 100% (soma atual: ${sum}).`);
        }

        const uid = await resolveUid();
        const current = (await store.getTargets(uid)) ?? {
          byAssetClass: {},
          byProductType: {},
        };
        const targets: Targets = {
          byAssetClass: byAssetClass ?? current.byAssetClass,
          byProductType: byProductType ?? current.byProductType,
        };

        const unknown = [
          ...Object.keys(targets.byAssetClass).filter(
            (k) => !ASSET_CLASSES.includes(k as never),
          ),
          ...Object.keys(targets.byProductType).filter(
            (k) => !PRODUCT_TYPES.includes(k as never),
          ),
        ];

        await store.saveTargets(uid, targets);
        return ok({
          saved: true,
          targets,
          ...(unknown.length
            ? { warning: `Chaves fora da taxonomia padrão: ${unknown.join(", ")}` }
            : {}),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_retirement_plan",
    {
      description:
        "Atualiza parâmetros do plano de aposentadoria (merge parcial). Se o plano ainda não existe, todos os campos são obrigatórios.",
      inputSchema: {
        nominalReturnPct: z
          .number()
          .optional()
          .describe("Rentabilidade anual nominal esperada, em % (ex.: 12)"),
        inflationPct: z.number().optional().describe("Inflação esperada, % a.a."),
        currentAge: z.number().optional(),
        retirementAge: z.number().optional().describe("Idade de início dos resgates"),
        initialValue: z.number().optional(),
        monthlyContribution: z.number().optional(),
        desiredMonthlyIncome: z
          .number()
          .optional()
          .describe("Renda passiva mensal desejada na fase de resgate"),
        lifeExpectancy: z.number().optional(),
      },
    },
    async (patch) => {
      try {
        const uid = await resolveUid();
        const existing = await store.getRetirement(uid);
        const clean = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(clean).length === 0)
          throw new Error("Nenhum campo informado para atualizar.");

        if (!existing) {
          const required: (keyof RetirementPlan)[] = [
            "nominalReturnPct",
            "inflationPct",
            "currentAge",
            "retirementAge",
            "initialValue",
            "monthlyContribution",
            "desiredMonthlyIncome",
            "lifeExpectancy",
          ];
          const missing = required.filter((k) => !(k in clean));
          if (missing.length)
            throw new Error(
              `Plano inexistente — campos obrigatórios faltando: ${missing.join(", ")}`,
            );
        }

        await store.saveRetirement(uid, clean);
        return ok({ saved: true, plan: { ...existing, ...clean } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_instrument_classification",
    {
      description:
        "Cria/atualiza a regra de classificação de um instrumento (classe de ativo e/ou tipo de produto) e aplica às posições correspondentes de um snapshot (mais recente por padrão). Identifique o instrumento por key exata ou por ticker/nome.",
      inputSchema: {
        key: z
          .string()
          .optional()
          .describe("Chave estável do instrumento (instrumentKey), se conhecida"),
        ticker: z.string().optional().describe("Ticker do ativo (ex.: IVVB11)"),
        name: z.string().optional().describe("Nome do ativo como aparece na planilha"),
        assetClass: z
          .string()
          .optional()
          .describe("Classe: " + ASSET_CLASSES.join(" | ")),
        productType: z
          .string()
          .optional()
          .describe("Tipo: " + PRODUCT_TYPES.join(" | ")),
        importId: z
          .string()
          .optional()
          .describe("Snapshot onde aplicar (omitido = mais recente)"),
      },
    },
    async ({ key, ticker, name, assetClass, productType, importId }) => {
      try {
        const ruleKey = key ?? (ticker || name ? instrumentKey({ ticker, name: name ?? ticker! }) : undefined);
        if (!ruleKey)
          throw new Error("Informe key, ticker ou name para identificar o instrumento.");
        if (!assetClass && !productType)
          throw new Error("Informe assetClass e/ou productType.");

        const warnings: string[] = [];
        if (assetClass && !ASSET_CLASSES.includes(assetClass as never))
          warnings.push(`assetClass "${assetClass}" fora da taxonomia padrão`);
        if (productType && !PRODUCT_TYPES.includes(productType as never))
          warnings.push(`productType "${productType}" fora da taxonomia padrão`);

        const uid = await resolveUid();
        const meta = await resolveImport(uid, importId);
        const updated = await store.saveRule(
          uid,
          ruleKey,
          { assetClass, productType },
          meta.id,
        );
        return ok({
          saved: true,
          rule: { key: ruleKey, assetClass, productType },
          positionsUpdated: updated,
          appliedToImport: meta.id,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_current_allocation",
    {
      description:
        "Importa a alocação atual criando um novo snapshot. Modo 1: envie o relatório 'Posição Detalhada' da XP em xlsxBase64 — o parser extrai posições e totais e reaplica as regras de classificação. Modo 2: envie positions já estruturadas + meta (patrimonio, totalInvestido, saldoDisponivel).",
      inputSchema: {
        fileName: z.string().optional().describe("Nome do arquivo (modo 1)"),
        xlsxBase64: z
          .string()
          .optional()
          .describe("Conteúdo do .xlsx da XP em base64 (modo 1)"),
        meta: z
          .object({
            patrimonio: z.number(),
            totalInvestido: z.number(),
            saldoDisponivel: z.number(),
            referenceDate: z.number().optional(),
          })
          .optional()
          .describe("Totais da carteira (modo 2)"),
        positions: z
          .array(
            z.object({
              name: z.string(),
              ticker: z.string().optional(),
              sourceSection: z.string().default("API"),
              assetClass: z.string(),
              productType: z.string(),
              balance: z.number(),
              allocationPct: z.number().default(0),
              quantity: z.number().optional(),
              maturity: z.string().optional(),
              yieldText: z.string().optional(),
            }),
          )
          .optional()
          .describe("Posições estruturadas (modo 2)"),
      },
    },
    async ({ fileName, xlsxBase64, meta, positions }) => {
      try {
        const uid = await resolveUid();
        const rules = await store.getRules(uid);

        let m: {
          patrimonio: number;
          totalInvestido: number;
          saldoDisponivel: number;
          referenceDate?: number;
        };
        let pos: Position[];
        let warnings: string[] = [];
        let name: string;

        if (xlsxBase64) {
          const buf = Buffer.from(xlsxBase64, "base64");
          const parsed = parseSpreadsheet(new Uint8Array(buf));
          if (parsed.positions.length === 0)
            throw new Error(
              "Nenhuma posição encontrada no arquivo. Verifique se é o relatório 'Posição Detalhada' da XP.",
            );
          pos = applyRules(parsed.positions, rules);
          m = parsed;
          warnings = parsed.warnings;
          name = fileName ?? `mcp-upload-${new Date().toISOString()}.xlsx`;
        } else if (positions && meta) {
          pos = positions.map((p) => ({
            ...p,
            instrumentKey: instrumentKey({ ticker: p.ticker, name: p.name }),
          })) as Position[];
          pos = applyRules(pos, rules);
          m = meta;
          name = fileName ?? `mcp-upload-${new Date().toISOString()}.json`;
        } else {
          throw new Error(
            "Envie xlsxBase64 (modo 1) ou positions + meta (modo 2).",
          );
        }

        const importId = await store.saveImport(uid, name, m, pos);
        return ok({
          saved: true,
          importId,
          positionCount: pos.length,
          patrimonio: m.patrimonio,
          totalInvestido: m.totalInvestido,
          saldoDisponivel: m.saldoDisponivel,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_annual_csv",
    {
      description:
        "Importa o CSV anual de patrimônio da XP (colunas: Ano, Patrimônio inicial, Movimentações, IR Pago + IRRF, IOF Pago, Patrimônio final, Rendimento, Rentabilidade, Rentabilidade % CDI) e substitui o histórico patrimonial salvo.",
      inputSchema: {
        csv: z.string().describe("Conteúdo textual do CSV anual da XP"),
      },
    },
    async ({ csv }) => {
      try {
        const years = parseWealthCsv(csv);
        if (years.length === 0)
          throw new Error(
            "Nenhum ano reconhecido no CSV. Confira o formato (veja docs/ para um exemplo).",
          );
        const uid = await resolveUid();
        await store.saveWealth(uid, years);
        return ok({ saved: true, years: years.length, range: `${years[0].year}–${years[years.length - 1].year}`, data: years });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
