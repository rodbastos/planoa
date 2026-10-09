import {
  collection,
  doc,
  deleteField,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
  deleteDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  AssetIntent,
  ImportMeta,
  InstrumentRule,
  Position,
  RebalancePreference,
  RebalanceSharePatch,
  RetirementPlan,
  Targets,
  WealthYear,
} from "./types";

const BATCH_LIMIT = 450;

function userRef(uid: string) {
  return doc(db, "users", uid);
}

export function importsRef(uid: string) {
  return collection(userRef(uid), "imports");
}

export function positionsRef(uid: string, importId: string) {
  return collection(userRef(uid), "imports", importId, "positions");
}

export function rulesRef(uid: string) {
  return collection(userRef(uid), "instrumentRules");
}

function validShare(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

export function subscribeRebalancePreferences(
  uid: string,
  cb: (preferences: Record<string, RebalancePreference>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(userRef(uid), "rebalancePreferences"), (snap) => {
    const entries: [string, RebalancePreference][] = [];
    for (const document of snap.docs) {
      const data = document.data();
      if (typeof data.key !== "string"
        || (data.intent !== undefined && data.intent !== "keep" && data.intent !== "exit")
        || !validShare(data.classSharePct) || !validShare(data.productSharePct)) {
        onError(new Error("Uma preferência de rebalanceamento é inválida. Não foi possível aplicar suas intenções com segurança."));
        return;
      }
      const preference: RebalancePreference = {};
      if (data.intent !== undefined) preference.intent = data.intent;
      if (data.classSharePct !== undefined) preference.classSharePct = data.classSharePct;
      if (data.productSharePct !== undefined) preference.productSharePct = data.productSharePct;
      entries.push([data.key, preference]);
    }
    cb(Object.fromEntries(entries));
  }, onError);
}

export async function saveRebalancePreference(uid: string, key: string, intent: AssetIntent): Promise<void> {
  if (!uid || !key || (intent !== "keep" && intent !== "exit")) throw new Error("Preferência de rebalanceamento inválida.");
  await setDoc(doc(collection(userRef(uid), "rebalancePreferences"), encodeURIComponent(key)), { key, intent }, { merge: true });
}

/** Salva o peso interno manual do ativo na classe/produto. `null` remove o peso salvo. */
export async function saveRebalanceShares(
  uid: string,
  key: string,
  shares: { classSharePct?: number | null; productSharePct?: number | null },
): Promise<void> {
  if (!uid || !key) throw new Error("Preferência de rebalanceamento inválida.");
  const data: Record<string, unknown> = { key };
  for (const [field, value] of Object.entries(shares)) {
    if (value === undefined) continue;
    if (value === null) { data[field] = deleteField(); continue; }
    if (!validShare(value)) throw new Error("O peso interno deve estar entre 0% e 100%.");
    data[field] = value;
  }
  if (Object.keys(data).length === 1) return;
  await setDoc(doc(collection(userRef(uid), "rebalancePreferences"), encodeURIComponent(key)), data, { merge: true });
}

export async function saveRebalanceDistribution(uid: string, updates: Record<string, RebalanceSharePatch>): Promise<void> {
  const entries = Object.entries(updates);
  if (!uid || entries.length > BATCH_LIMIT) throw new Error("Não foi possível salvar a distribuição: usuário inválido ou muitos ativos.");
  if (!entries.length) return;
  const batch = writeBatch(db);
  for (const [key, shares] of entries) {
    if (!key) throw new Error("Preferência de rebalanceamento inválida.");
    const data: Record<string, unknown> = { key };
    for (const field of ["classSharePct", "productSharePct"] as const) {
      const value = shares[field];
      if (value === undefined) continue;
      if (value !== null && !validShare(value)) throw new Error("A meta interna deve estar entre 0% e 100%.");
      data[field] = value === null ? deleteField() : value;
    }
    if (Object.keys(data).length > 1) {
      batch.set(doc(collection(userRef(uid), "rebalancePreferences"), encodeURIComponent(key)), data, { merge: true });
    }
  }
  await batch.commit();
}

export function targetsRef(uid: string) {
  return doc(userRef(uid), "settings", "targets");
}

export function retirementRef(uid: string) {
  return doc(userRef(uid), "settings", "retirement");
}

export function wealthRef(uid: string) {
  return doc(userRef(uid), "settings", "wealth");
}

/** Grava um novo snapshot: doc de import + posições em batches */
export async function saveImport(
  uid: string,
  fileName: string,
  meta: {
    patrimonio: number;
    totalInvestido: number;
    saldoDisponivel: number;
    referenceDate?: number;
  },
  positions: Position[],
): Promise<string> {
  const importDoc = doc(importsRef(uid));
  await setDoc(importDoc, {
    uploadedAt: Date.now(),
    ...(meta.referenceDate !== undefined
      ? { referenceDate: meta.referenceDate }
      : {}),
    fileName,
    patrimonio: meta.patrimonio,
    totalInvestido: meta.totalInvestido,
    saldoDisponivel: meta.saldoDisponivel,
    positionCount: positions.length,
  });

  for (let i = 0; i < positions.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const p of positions.slice(i, i + BATCH_LIMIT)) {
      const ref = doc(positionsRef(uid, importDoc.id));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...data } = p;
      batch.set(ref, data);
    }
    await batch.commit();
  }
  return importDoc.id;
}

/** Remove um import e todas as suas posições */
export async function deleteImport(uid: string, importId: string): Promise<void> {
  const snap = await getDocs(positionsRef(uid, importId));
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(doc(userRef(uid), "imports", importId));
}

export function subscribeImports(
  uid: string,
  cb: (imports: ImportMeta[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(importsRef(uid), orderBy("uploadedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ImportMeta)),
    onError,
  );
}

export function subscribePositions(
  uid: string,
  importId: string,
  cb: (positions: Position[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    positionsRef(uid, importId),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Position)),
    onError,
  );
}

export function subscribeRules(
  uid: string,
  cb: (rules: Record<string, InstrumentRule>) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    rulesRef(uid),
    (snap) => {
      const rules: Record<string, InstrumentRule> = {};
      snap.docs.forEach((d) => (rules[d.id] = d.data() as InstrumentRule));
      cb(rules);
    },
    onError,
  );
}

/**
 * Salva regra de classificação para um instrumento e aplica às posições
 * correspondentes no import informado.
 */
export async function saveRule(
  uid: string,
  key: string,
  rule: InstrumentRule,
  importId?: string,
): Promise<void> {
  const docId = encodeURIComponent(key);
  await setDoc(doc(rulesRef(uid), docId), { key, ...rule }, { merge: true });

  if (importId) {
    const snap = await getDocs(positionsRef(uid, importId));
    const batch = writeBatch(db);
    let n = 0;
    for (const d of snap.docs) {
      const p = d.data() as Position;
      if (p.instrumentKey === key) {
        batch.update(d.ref, {
          ...(rule.assetClass ? { assetClass: rule.assetClass } : {}),
          ...(rule.productType ? { productType: rule.productType } : {}),
        });
        n++;
      }
    }
    if (n > 0) await batch.commit();
  }
}

export async function deleteRule(uid: string, key: string): Promise<void> {
  await deleteDoc(doc(rulesRef(uid), encodeURIComponent(key)));
}

export function subscribeTargets(
  uid: string,
  cb: (targets: Targets | null) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    targetsRef(uid),
    (snap) => cb(snap.exists() ? (snap.data() as Targets) : null),
    onError,
  );
}

export async function saveTargets(uid: string, targets: Targets): Promise<void> {
  await setDoc(targetsRef(uid), targets, { merge: true });
}

export function subscribeRetirement(
  uid: string,
  cb: (plan: RetirementPlan | null) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    retirementRef(uid),
    (snap) => cb(snap.exists() ? (snap.data() as RetirementPlan) : null),
    onError,
  );
}

export async function saveRetirement(
  uid: string,
  plan: RetirementPlan,
): Promise<void> {
  await setDoc(retirementRef(uid), plan, { merge: true });
}

export function subscribeWealth(
  uid: string,
  cb: (years: WealthYear[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    wealthRef(uid),
    (snap) => {
      const d = snap.exists() ? (snap.data() as { years?: WealthYear[] }) : null;
      cb(d?.years ?? []);
    },
    onError,
  );
}

export async function saveWealth(
  uid: string,
  years: WealthYear[],
): Promise<void> {
  await setDoc(wealthRef(uid), { years }, { merge: true });
}

// ---------------------------------------------------------------------------
// Chaves MCP (acesso de IAs via servidor mcp/)
// ---------------------------------------------------------------------------

export function mcpTokensRef(uid: string) {
  return collection(userRef(uid), "mcpTokens");
}

export interface McpTokenMeta {
  id: string;
  /** últimos 6 chars do token, só para identificar na UI */
  hint: string;
  createdAt: number;
}

export function subscribeMcpTokens(
  uid: string,
  cb: (tokens: McpTokenMeta[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(mcpTokensRef(uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as McpTokenMeta)),
    onError,
  );
}

/**
 * Gera uma chave MCP para o usuário. Retorna o token cru — exibir UMA vez;
 * no Firestore fica apenas o hash SHA-256 (o servidor resolve hash → uid).
 */
export async function createMcpToken(uid: string): Promise<string> {
  const token = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const tokenHash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  await setDoc(doc(mcpTokensRef(uid)), {
    uid,
    tokenHash,
    hint: token.slice(-6),
    createdAt: Date.now(),
  });
  return token;
}

export async function deleteMcpToken(
  uid: string,
  tokenId: string,
): Promise<void> {
  await deleteDoc(doc(mcpTokensRef(uid), tokenId));
}
