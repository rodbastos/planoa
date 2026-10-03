import { useEffect, useState } from "react";
import type { ImportMeta, Position } from "../lib/types";
import {
  subscribePositions,
  subscribeRetirement,
  subscribeRules,
  subscribeTargets,
  subscribeWealth,
} from "../lib/firestore";
import { useAuth } from "./useAuth";
import { useImports } from "./useImports";
import type {
  InstrumentRule,
  RetirementPlan,
  Targets,
  WealthYear,
} from "../lib/types";

interface PortfolioState {
  importMeta: ImportMeta | null;
  positions: Position[];
  loading: boolean;
  error: string | null;
}

export function usePortfolio(): PortfolioState {
  const { user } = useAuth();
  const { selected, loading: loadingImports } = useImports();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadingPos, setLoadingPos] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const importId = selected?.id;

  useEffect(() => {
    if (!user || !importId) {
      setPositions([]);
      setLoadingPos(false);
      return;
    }
    setLoadingPos(true);
    return subscribePositions(
      user.uid,
      importId,
      (pos) => {
        setPositions(pos);
        setLoadingPos(false);
      },
      (e) => {
        setError(e.message);
        setLoadingPos(false);
      },
    );
  }, [user, importId]);

  return {
    importMeta: selected,
    positions,
    loading: loadingImports || (!!importId && loadingPos),
    error,
  };
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

export function useRetirementPlan(): {
  plan: RetirementPlan | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const [plan, setPlan] = useState<RetirementPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    return subscribeRetirement(
      user.uid,
      (p) => {
        setPlan(p);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user]);

  return { plan, loading };
}

export function useWealthYears(): {
  years: WealthYear[];
  loading: boolean;
} {
  const { user } = useAuth();
  const [years, setYears] = useState<WealthYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    return subscribeWealth(
      user.uid,
      (y) => {
        setYears(y);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user]);

  return { years, loading };
}
