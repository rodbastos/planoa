import { useEffect, useState } from "react";
import type { ImportMeta, Position } from "../lib/types";
import {
  subscribeLatestImport,
  subscribePositions,
  subscribeRules,
  subscribeTargets,
} from "../lib/firestore";
import { useAuth } from "./useAuth";
import type { InstrumentRule, Targets } from "../lib/types";

interface PortfolioState {
  importMeta: ImportMeta | null;
  positions: Position[];
  loading: boolean;
  error: string | null;
}

export function usePortfolio(): PortfolioState {
  const { user } = useAuth();
  const [importMeta, setImportMeta] = useState<ImportMeta | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    return subscribeLatestImport(
      user.uid,
      (meta) => {
        setImportMeta(meta);
        if (!meta) {
          setPositions([]);
          setLoading(false);
        }
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user || !importMeta) return;
    return subscribePositions(
      user.uid,
      importMeta.id,
      (pos) => {
        setPositions(pos);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [user, importMeta]);

  return { importMeta, positions, loading, error };
}

export function useRules(): {
  rules: Record<string, InstrumentRule>;
  loading: boolean;
} {
  const { user } = useAuth();
  const [rules, setRules] = useState<Record<string, InstrumentRule>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    return subscribeRules(
      user.uid,
      (r) => {
        setRules(r);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user]);

  return { rules, loading };
}

export function useTargets(): {
  targets: Targets | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const [targets, setTargets] = useState<Targets | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    return subscribeTargets(
      user.uid,
      (t) => {
        setTargets(t);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user]);

  return { targets, loading };
}
