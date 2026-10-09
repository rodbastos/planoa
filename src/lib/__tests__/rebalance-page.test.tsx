import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { RebalanceamentoPage } from "../../pages/RebalanceamentoPage";
import { usePortfolio, useRebalancePreferences, useTargets } from "../../hooks/usePortfolio";
import { rebalancePreferenceKey } from "../rebalance";
import type { ImportMeta } from "../types";

vi.mock("../../hooks/usePortfolio", () => ({
  usePortfolio: vi.fn(),
  useTargets: vi.fn(),
  useRebalancePreferences: vi.fn(),
}));
vi.mock("../../components/ImportSelector", () => ({ ImportSelector: () => null }));
vi.mock("../../hooks/useImports", () => ({
  importDate: (meta: ImportMeta) => meta.referenceDate ?? meta.uploadedAt,
}));

const portfolio: ReturnType<typeof usePortfolio> = {
  importMeta: {
    id: "test", uploadedAt: 1791457200000, fileName: "test.xlsx",
    patrimonio: 10000, totalInvestido: 10000, saldoDisponivel: 500, positionCount: 2,
  },
  positions: [
    { name: "Título", assetClass: "Pós-Fixado CDI", productType: "Títulos Privados", sourceSection: "Renda Fixa", balance: 8000, allocationPct: 80 },
    { name: "Ação", assetClass: "Renda Variável Brasil", productType: "Ações", sourceSection: "Ações", balance: 2000, allocationPct: 20 },
  ],
  loading: false,
  error: null,
};

function render(location = "/rebalanceamento") {
  return renderToStaticMarkup(<StaticRouter location={location}><RebalanceamentoPage /></StaticRouter>);
}

const preferences = { preferences: {}, loading: false, error: null, saveIntent: vi.fn().mockResolvedValue(undefined), saveShare: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences });
  vi.mocked(usePortfolio).mockReturnValue(portfolio);
  vi.mocked(useTargets).mockReturnValue({
    targets: {
      byAssetClass: { "Pós-Fixado CDI": 50, "Renda Variável Brasil": 50 },
      byProductType: { "Títulos Privados": 60, Ações: 40 },
    },
    loading: false,
  });
});

describe("RebalanceamentoPage", () => {
  it("abre por ativo e permite incluir ativos futuros", () => {
    const html = render();
    expect(html).toContain("Cenário e plano");
    expect(html).toContain("Adicionar ativo");
    expect(html).toContain("Meta (%)");
    expect(html).toContain('aria-label="Intenção para Título"');
    expect(html).toContain("Sair quando possível");
  });

  it("ordena a tabela por classe, independente da ordem de importação", () => {
    vi.mocked(usePortfolio).mockReturnValue({ ...portfolio, positions: [
      { name: "Ação Z", assetClass: "Renda Variável Brasil", productType: "Ações", sourceSection: "Ações", balance: 2000, allocationPct: 20 },
      { name: "Título", assetClass: "Pós-Fixado CDI", productType: "Títulos Privados", sourceSection: "Renda Fixa", balance: 8000, allocationPct: 80 },
    ] });
    const html = render();
    expect(html.indexOf("Título")).toBeLessThan(html.indexOf("Ação Z"));
  });

  it("usa a visão de classes sem perder o plano por ativo", () => {
    const html = render("/rebalanceamento?visao=classes");
    expect(html).toContain("Peso na classe (%)");
    expect(html).toContain("Cenário e plano");
    expect(html).toContain("Título");
  });

  it("usa o peso interno salvo na conta nas próximas sugestões", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences,
      preferences: { [rebalancePreferenceKey(portfolio.positions[0])]: { classSharePct: 90 } },
    });
    const html = render("/rebalanceamento?visao=classes");
    expect(html).toContain('value="90"');
    expect(html).toContain("Restaurar pesos");
  });

  it("aplica intenções salvas aos ativos e sinaliza saída sem novos aportes", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences,
      preferences: { [rebalancePreferenceKey(portfolio.positions[0])]: { intent: "exit" } },
    });
    const html = render();
    expect(html).toContain("Em saída");
    expect(html).toContain("Aguardar saída");
    expect(html).toContain("Cenário e plano");
  });

  it("suspende sugestões se não puder carregar as intenções salvas", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ preferences: {}, loading: false, error: "Sem conexão", saveIntent: vi.fn(), saveShare: vi.fn() });
    const html = render();
    expect(html).toContain("As sugestões estão suspensas");
    expect(html).not.toContain("Cenário e plano");
  });

  it("aguarda as intenções antes de calcular qualquer sugestão", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ preferences: {}, loading: true, error: null, saveIntent: vi.fn(), saveShare: vi.fn() });
    expect(render()).not.toContain("Cenário e plano");
  });

  it("mostra a simulação com a carteira e as metas por classe", () => {
    const html = render();
    expect(html).toContain("Cenário e plano");
    expect(html).toContain("Pós-Fixado CDI");
    expect(html).toContain("Renda Variável Brasil");
    expect(html).toContain("6.000,00");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("10.500,00");
  });

  it("usa metas e categorias de produto ao abrir a visão de produtos", () => {
    const html = render("/rebalanceamento?visao=produtos");
    expect(html).toContain("Títulos Privados");
    expect(html).toContain("3.333,34");
    expect(html).toContain("Título");
    expect(html).toContain("Peso na categoria (%)");
    expect(html).not.toContain('role="alert"');
  });

  it("orienta a importação quando ainda não há carteira", () => {
    vi.mocked(usePortfolio).mockReturnValue({ ...portfolio, positions: [], importMeta: null });
    const html = render();
    expect(html).toContain('href="/importar"');
    expect(html).not.toContain("Cenário e plano");
  });

  it("não mostra sugestões quando faltam metas", () => {
    vi.mocked(useTargets).mockReturnValue({ targets: null, loading: false });
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("somar 100%");
    expect(html).not.toContain("6.000,00");
  });

  it("não exibe resultados enquanto a carteira está carregando", () => {
    vi.mocked(usePortfolio).mockReturnValue({ ...portfolio, loading: true });
    expect(render()).not.toContain("Cenário e plano");
  });

  it("não usa dados antigos quando o carregamento falha", () => {
    vi.mocked(usePortfolio).mockReturnValue({ ...portfolio, error: "Falha de conexão" });
    const html = render();
    expect(html).toContain("Falha de conexão");
    expect(html).not.toContain("Cenário e plano");
  });

  it("mantém categorias não padronizadas para não ignorar patrimônio", () => {
    vi.mocked(usePortfolio).mockReturnValue({ ...portfolio, positions: [
      ...portfolio.positions,
      { ...portfolio.positions[0], name: "Outra posição", assetClass: "Não classificado", balance: 1000 },
    ] });
    const html = render();
    expect(html).toContain("Não classificado");
    expect(html).toContain("11.000,00");
    expect(html).toContain("Nenhum aporte finito");
  });
});
