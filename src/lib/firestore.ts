import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
  deleteDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { ImportMeta, InstrumentRule, Position, Targets } from "./types";

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

export function targetsRef(uid: string) {
  return doc(userRef(uid), "settings", "targets");
}

/** Grava um novo snapshot: doc de import + posições em batches */
export async function saveImport(
  uid: string,
  fileName: string,
  meta: {
    patrimonio: number;
    totalInvestido: number;
    saldoDisponivel: number;
  },
  positions: Position[],
): Promise<string> {
  const importDoc = doc(importsRef(uid));
  await setDoc(importDoc, {
    uploadedAt: Date.now(),
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

/** Escuta o import mais recente */
export function subscribeLatestImport(
  uid: string,
  cb: (meta: ImportMeta | null) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(importsRef(uid), orderBy("uploadedAt", "desc"), limit(1));
  return onSnapshot(
    q,
    (snap) => {
      const d = snap.docs[0];
      cb(d ? ({ id: d.id, ...d.data() } as ImportMeta) : null);
    },
    onError,
  );
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
