import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ImportMeta } from "../lib/types";
import { subscribeImports } from "../lib/firestore";
import { useAuth } from "./useAuth";

/** data efetiva do snapshot: data de referência do relatório, senão o upload */
export function importDate(imp: ImportMeta): number {
  return imp.referenceDate ?? imp.uploadedAt;
}

interface ImportsCtx {
  /** todas as importações, da mais recente para a mais antiga */
  imports: ImportMeta[];
  /** importação exibida nas páginas — a mais recente, salvo seleção manual */
  selected: ImportMeta | null;
  selectImport: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<ImportsCtx>({
  imports: [],
  selected: null,
  selectImport: () => {},
  loading: true,
});

export function ImportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [list, setList] = useState<ImportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setList([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeImports(
      user.uid,
      (l) => {
        setList(l);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user]);

  const imports = useMemo(
    () => [...list].sort((a, b) => importDate(b) - importDate(a)),
    [list],
  );

  // se a seleção aponta para uma importação removida, cai na mais recente
  const selected =
    imports.find((i) => i.id === selectedId) ?? imports[0] ?? null;

  return (
    <Ctx.Provider
      value={{ imports, selected, selectImport: setSelectedId, loading }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useImports() {
  return useContext(Ctx);
}
