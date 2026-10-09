import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter, StaticRouter } from "react-router-dom";
import { RebalanceamentoPage } from "../../pages/RebalanceamentoPage";
import { usePortfolio, useRebalancePreferences, useTargets } from "../../hooks/usePortfolio";
import { rebalancePreferenceKey } from "../rebalance";
import * as rebalance from "../rebalance";
import type { ImportMeta, RebalancePreference, RebalanceSharePatch } from "../types";

vi.mock("../../hooks/usePortfolio", () => ({
  usePortfolio: vi.fn(),
  useTargets: vi.fn(),
  useRebalancePreferences: vi.fn(),
}));
vi.mock("../../components/ImportSelector", () => ({ ImportSelector: () => null }));
vi.mock("../../hooks/useImports", () => ({
  importDate: (meta: ImportMeta) => meta.referenceDate ?? meta.uploadedAt,
}));
vi.mock("recharts", async (importOriginal) => ({
  ...await importOriginal<typeof import("recharts")>(), ResponsiveContainer: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
const pairedPortfolio = { ...portfolio, positions: [
  { ...portfolio.positions[0], balance: 6000 },
  { ...portfolio.positions[0], name: "Outro título", balance: 2000 },
  portfolio.positions[1],
] };

function render(location = "/rebalanceamento") {
  return renderToStaticMarkup(<StaticRouter location={location}><RebalanceamentoPage /></StaticRouter>);
}

const preferences = {
  preferences: {}, loading: false, error: null,
  saveIntent: vi.fn(), saveShare: vi.fn(), saveShares: vi.fn(),
};
let mounted: ReactTestRenderer[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  preferences.saveShares.mockResolvedValue(undefined);
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

afterEach(() => {
  act(() => mounted.forEach((page) => page.unmount()));
  mounted = [];
  vi.restoreAllMocks();
});

function mount(location = "/rebalanceamento") {
  let page!: ReactTestRenderer;
  act(() => { page = create(<MemoryRouter initialEntries={[location]}><RebalanceamentoPage /></MemoryRouter>); });
  mounted.push(page);
  return page;
}

function shareInput(page: ReactTestRenderer, name: string, group = "da classe") {
  return page.root.findAllByType("input").find((input) => input.props["aria-label"] === `Meta de ${name} dentro ${group} (%)`)!;
}

function button(page: ReactTestRenderer, text: string) {
  return page.root.findAllByType("button").find((node) => node.children.join("") === text)!;
}

function editShare(page: ReactTestRenderer, name: string, value: number, group = "da classe") {
  act(() => shareInput(page, name, group).props.onChange({ target: { value: String(value), valueAsNumber: value } }));
}

function mockPersistedShares(initial: Record<string, RebalancePreference> = {}) {
  let saved = initial;
  vi.mocked(useRebalancePreferences).mockImplementation(() => {
    const [stored, setStored] = useState(saved);
    return { ...preferences, preferences: stored, saveShares: async (updates: Record<string, RebalanceSharePatch>) => {
      await preferences.saveShares(updates);
      saved = { ...saved };
      for (const [key, patch] of Object.entries(updates)) {
        saved[key] = { ...saved[key] };
        for (const field of ["classSharePct", "productSharePct"] as const) {
          const value = patch[field];
          if (value === null) delete saved[key][field];
          else if (value !== undefined) saved[key][field] = value;
        }
      }
      setStored(saved);
    } };
  });
}

describe("RebalanceamentoPage", () => {
  it("abre com metas internas por classe e permite incluir ativos futuros", () => {
    const html = render();
    expect(html).toContain("Cenário e plano");
    expect(html).toContain("Adicionar ativo");
    expect(html).toContain("Meta dentro da classe (%)");
    expect(html).toContain('aria-label="Intenção para Título"');
    expect(html).toContain("Sair quando possível");
  });

  it("edita a participação dentro da classe na tela padrão, sem meta global manual", () => {
    const html = render();
    expect(html).toContain('aria-label="Meta de Título dentro da classe (%)"');
    expect(html).toContain("Salvar distribuição");
    expect(html).toContain('href="/carteira-ideal"');
    expect(html).not.toContain("Meta manual de");
    expect(html).not.toContain("override");
    expect(html).not.toContain('aria-label="Meta de Pós-Fixado CDI (%)"');
  });

  it("ordena a tabela por classe, independente da ordem de importação", () => {
    vi.mocked(usePortfolio).mockReturnValue({ ...portfolio, positions: [...portfolio.positions].reverse() });
    const html = render();
    expect(html.indexOf('aria-label="Intenção para Título"')).toBeLessThan(html.indexOf('aria-label="Intenção para Ação"'));
  });

  it("mantém metas internas também em URLs antigas", () => {
    for (const view of ["classes", "ativos"]) {
      const html = render(`/rebalanceamento?visao=${view}`);
      expect(html).toContain("Meta dentro da classe (%)");
      expect(html).not.toContain("Meta manual de");
    }
  });

  it("usa a distribuição salva sem depender de trocar a visão", () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences,
      preferences: {
        [rebalancePreferenceKey(pairedPortfolio.positions[0])]: { classSharePct: 50 },
        [rebalancePreferenceKey(pairedPortfolio.positions[1])]: { classSharePct: 50 },
      },
    });
    const page = mount();
    expect(shareInput(page, "Título").props.value).toBe(50);
    expect(shareInput(page, "Outro título").props.value).toBe(50);
    expect(shareInput(page, "Ação").props.value).toBe(100);
  });

  it("edita, salva explicitamente e recarrega a distribuição sem alterar metas de classe", async () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    mockPersistedShares();
    const simulation = vi.spyOn(rebalance, "simulateAssetRebalance");
    const page = mount();
    expect(shareInput(page, "Título").props.value).toBe(75);
    expect(button(page, "Salvar distribuição").props.disabled).toBe(true);
    editShare(page, "Título", 50);
    editShare(page, "Outro título", 50);
    expect(preferences.saveShares).not.toHaveBeenCalled();
    expect(shareInput(page, "Título").props.onBlur).toBeUndefined();
    expect(button(page, "Salvar distribuição").props.disabled).toBe(false);
    expect(JSON.stringify(page.toJSON())).toContain("Alterações não salvas");
    const input = simulation.mock.lastCall![0];
    expect(input.dimension).toBe("assetClass");
    expect(input.targets).toEqual({ "Pós-Fixado CDI": 50, "Renda Variável Brasil": 50 });
    expect(rebalance.assetTargetCategories(input.assets, input.dimension, input.targets).map((row) => row.targetPct)).toEqual([25, 25, 50]);
    await act(async () => { await button(page, "Salvar distribuição").props.onClick(); });
    expect(preferences.saveShares).toHaveBeenCalledExactlyOnceWith({
      [rebalancePreferenceKey(pairedPortfolio.positions[0])]: { classSharePct: 50 },
      [rebalancePreferenceKey(pairedPortfolio.positions[1])]: { classSharePct: 50 },
    });
    expect(JSON.stringify(page.toJSON())).toContain("Distribuição salva na sua conta");
    expect(JSON.stringify(page.toJSON())).not.toContain("Alterações não salvas");
    expect(shareInput(page, "Título").props.value).toBe(50);
    const reloaded = mount();
    expect(shareInput(reloaded, "Título").props.value).toBe(50);
    expect(shareInput(reloaded, "Outro título").props.value).toBe(50);
  });

  it("não normaliza silenciosamente 50/30 e bloqueia salvar até completar 100% da classe", () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    const page = mount();
    editShare(page, "Título", 50);
    editShare(page, "Outro título", 30);
    expect(shareInput(page, "Título").props.value).toBe(50);
    expect(shareInput(page, "Outro título").props.value).toBe(30);
    expect(button(page, "Salvar distribuição").props.disabled).toBe(true);
    expect(JSON.stringify(page.toJSON())).toContain("ajuste para somar 100%");
    expect(preferences.saveShares).not.toHaveBeenCalled();
  });

  it("mantém a edição após falha e permite tentar salvar novamente", async () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    mockPersistedShares();
    preferences.saveShares.mockRejectedValueOnce(new Error("Sem conexão"));
    const page = mount();
    editShare(page, "Título", 60);
    editShare(page, "Outro título", 40);
    await act(async () => { await button(page, "Salvar distribuição").props.onClick(); });
    expect(shareInput(page, "Título").props.value).toBe(60);
    expect(JSON.stringify(page.toJSON())).toContain("Não foi possível salvar a distribuição");
    expect(JSON.stringify(page.toJSON())).not.toContain("Distribuição salva na sua conta");
    expect(button(page, "Salvar distribuição").props.disabled).toBe(false);
    await act(async () => { await button(page, "Salvar distribuição").props.onClick(); });
    expect(preferences.saveShares).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(page.toJSON())).toContain("Distribuição salva na sua conta");
  });

  it("sinaliza gravação pendente e só confirma depois da persistência", async () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    mockPersistedShares();
    let finish!: () => void;
    preferences.saveShares.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const page = mount();
    editShare(page, "Título", 60);
    editShare(page, "Outro título", 40);
    let pending!: Promise<void>;
    act(() => { pending = button(page, "Salvar distribuição").props.onClick(); });
    expect(button(page, "Salvando distribuição…").props.disabled).toBe(true);
    expect(shareInput(page, "Título").props.disabled).toBe(true);
    expect(JSON.stringify(page.toJSON())).not.toContain("Distribuição salva na sua conta");
    await act(async () => { finish(); await pending; });
    expect(JSON.stringify(page.toJSON())).toContain("Distribuição salva na sua conta");
  });

  it("restaura a sugestão somente após salvar e mantém a intenção", async () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    mockPersistedShares({
      [rebalancePreferenceKey(pairedPortfolio.positions[0])]: { classSharePct: 50, intent: "exit" },
      [rebalancePreferenceKey(pairedPortfolio.positions[1])]: { classSharePct: 50 },
    });
    const page = mount();
    act(() => button(page, "Restaurar sugestão").props.onClick());
    expect(shareInput(page, "Título").props.value).toBe(75);
    expect(preferences.saveShares).not.toHaveBeenCalled();
    await act(async () => { await button(page, "Salvar distribuição").props.onClick(); });
    expect(preferences.saveShares).toHaveBeenCalledWith(Object.fromEntries(pairedPortfolio.positions.map((position) => [rebalancePreferenceKey(position), { classSharePct: null }])));
    const reloaded = mount();
    expect(shareInput(reloaded, "Título").props.value).toBe(75);
    expect(reloaded.root.findAllByType("select").find((select) => select.props["aria-label"] === "Intenção para Título")!.props.value).toBe("exit");
  });

  it("salva a participação no produto separadamente da participação na classe", async () => {
    vi.mocked(usePortfolio).mockReturnValue(pairedPortfolio);
    mockPersistedShares();
    const page = mount("/rebalanceamento?visao=produtos");
    editShare(page, "Título", 60, "do produto");
    editShare(page, "Outro título", 40, "do produto");
    await act(async () => { await button(page, "Salvar distribuição").props.onClick(); });
    expect(preferences.saveShares).toHaveBeenCalledExactlyOnceWith({
      [rebalancePreferenceKey(pairedPortfolio.positions[0])]: { productSharePct: 60 },
      [rebalancePreferenceKey(pairedPortfolio.positions[1])]: { productSharePct: 40 },
    });
    const classes = mount();
    expect(shareInput(classes, "Título").props.value).toBe(75);
  });

  it("aplica intenções salvas aos ativos e sinaliza saída sem novos aportes", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences,
      preferences: { [rebalancePreferenceKey(portfolio.positions[0])]: { intent: "exit" } },
    });
    const html = render();
    expect(html).toContain("Em saída");
    expect(html).toContain("não tem ativo elegível");
    expect(html).toContain("Meta efetiva: 0%");
  });

  it("suspende sugestões se não puder carregar as intenções salvas", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences, error: "Sem conexão" });
    const html = render();
    expect(html).toContain("As sugestões estão suspensas");
    expect(html).not.toContain("Cenário e plano");
  });

  it("aguarda as intenções antes de calcular qualquer sugestão", () => {
    vi.mocked(useRebalancePreferences).mockReturnValue({ ...preferences, loading: true });
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
    expect(html).toContain("Meta dentro do produto (%)");
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
