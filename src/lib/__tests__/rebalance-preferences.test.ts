import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRebalancePreference, subscribeRebalancePreferences } from "../firestore";

const mocks = vi.hoisted(() => ({
  setDoc: vi.fn(),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../firebase", () => ({ db: "db" }));
vi.mock("firebase/firestore", () => ({
  doc: (...parts: string[]) => parts.join("/"),
  collection: (...parts: string[]) => parts.join("/"),
  setDoc: mocks.setDoc,
  onSnapshot: mocks.onSnapshot,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setDoc.mockResolvedValue(undefined);
  mocks.onSnapshot.mockReturnValue(mocks.unsubscribe);
});

describe("preferências de rebalanceamento", () => {
  it("salva a intenção isolada por usuário, sem alterar importações ou classificação", async () => {
    const key = JSON.stringify(["CDB BANCO A / IPCA", "2030-01-01"]);
    await saveRebalancePreference("user-a", key, "exit");
    expect(mocks.setDoc).toHaveBeenCalledExactlyOnceWith(
      `db/users/user-a/rebalancePreferences/${encodeURIComponent(key)}`,
      { key, intent: "exit" }, { merge: true },
    );
  });

  it("permite voltar a manter sem excluir outros dados", async () => {
    await saveRebalancePreference("user-a", "ativo", "keep");
    expect(mocks.setDoc).toHaveBeenCalledWith("db/users/user-a/rebalancePreferences/ativo", { key: "ativo", intent: "keep" }, { merge: true });
  });

  it("propaga falhas de gravação para a tela não confirmar uma preferência perdida", async () => {
    mocks.setDoc.mockRejectedValueOnce(new Error("Sem permissão"));
    await expect(saveRebalancePreference("user-a", "ativo", "exit")).rejects.toThrow("Sem permissão");
  });

  it("rejeita usuário ou chave vazios antes de gravar", async () => {
    await expect(saveRebalancePreference("", "ativo", "exit")).rejects.toThrow();
    await expect(saveRebalancePreference("user-a", "", "exit")).rejects.toThrow();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it("carrega pelas chaves originais e não pelo ID codificado do documento", () => {
    const callback = vi.fn();
    const error = vi.fn();
    const unsubscribe = subscribeRebalancePreferences("user-a", callback, error);
    expect(mocks.onSnapshot).toHaveBeenCalledWith("db/users/user-a/rebalancePreferences", expect.any(Function), error);
    const listener = mocks.onSnapshot.mock.calls[0][1];
    listener({ docs: [
      { data: () => ({ key: '["ATIVO / A",""]', intent: "exit" }) },
      { data: () => ({ key: "outro", intent: "keep" }) },
    ] });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ '["ATIVO / A",""]': "exit", outro: "keep" });
    expect(error).not.toHaveBeenCalled();
    expect(unsubscribe).toBe(mocks.unsubscribe);
  });

  it("não transforma preferência inválida silenciosamente em Manter", () => {
    const callback = vi.fn();
    const error = vi.fn();
    subscribeRebalancePreferences("user-a", callback, error);
    mocks.onSnapshot.mock.calls[0][1]({ docs: [{ data: () => ({ key: "ativo", intent: "inválido" }) }] });
    expect(callback).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("retorna preferências vazias apenas quando não há documentos", () => {
    const callback = vi.fn();
    subscribeRebalancePreferences("user-a", callback, vi.fn());
    mocks.onSnapshot.mock.calls[0][1]({ docs: [] });
    expect(callback).toHaveBeenCalledExactlyOnceWith({});
  });
});
