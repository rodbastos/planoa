import fs from "node:fs";
import admin from "firebase-admin";
import type {
  ImportMeta,
  InstrumentRule,
  Position,
  RetirementPlan,
  Targets,
  WealthYear,
} from "../../src/lib/types";
import { env } from "./config";

function initApp(): admin.app.App {
  if (admin.apps.length) return admin.apps[0]!;

  if (env.serviceAccountJson) {
    return admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(env.serviceAccountJson) as admin.ServiceAccount,
      ),
      projectId: env.projectId,
    });
  }

  if (env.serviceAccountPath && fs.existsSync(env.serviceAccountPath)) {
    const sa = JSON.parse(
      fs.readFileSync(env.serviceAccountPath, "utf8"),
    ) as admin.ServiceAccount;
    return admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: env.projectId,
    });
  }

  // fallback: Application Default Credentials (gcloud auth application-default login)
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: env.projectId,
  });
}

const app = initApp();
export const db = admin.firestore(app);
const auth = admin.auth(app);

const BATCH_LIMIT = 450;

let cachedUid: string | undefined;

/** Resolve o uid dono dos dados: ALLOCA_UID, ou ALLOCA_USER_EMAIL → Auth */
export async function getUid(): Promise<string> {
  if (cachedUid) return cachedUid;
  if (env.allocaUid) return (cachedUid = env.allocaUid);
  if (env.allocaUserEmail) {
    const user = await auth.getUserByEmail(env.allocaUserEmail);
    return (cachedUid = user.uid);
  }
  throw new Error(
    "Configure ALLOCA_UID ou ALLOCA_USER_EMAIL no mcp/.env para identificar o usuário.",
  );
}

function userRef(uid: string) {
  return db.collection("users").doc(uid);
}

// ---------------------------------------------------------------------------
// Imports / posições
// ---------------------------------------------------------------------------

export async function listImports(uid: string): Promise<ImportMeta[]> {
  const snap = await userRef(uid)
    .collection("imports")
    .orderBy("uploadedAt", "desc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ImportMeta);
}

export async function getLatestImport(uid: string): Promise<ImportMeta | null> {
  const snap = await userRef(uid)
    .collection("imports")
    .orderBy("uploadedAt", "desc")
    .limit(1)
    .get();
  const d = snap.docs[0];
  return d ? ({ id: d.id, ...d.data() } as ImportMeta) : null;
}

export async function getImport(
  uid: string,
  importId: string,
): Promise<ImportMeta | null> {
  const d = await userRef(uid).collection("imports").doc(importId).get();
  return d.exists ? ({ id: d.id, ...d.data() } as ImportMeta) : null;
}

export async function getPositions(
  uid: string,
  importId: string,
): Promise<Position[]> {
  const snap = await userRef(uid)
    .collection("imports")
    .doc(importId)
    .collection("positions")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Position);
}

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
  const importDoc = userRef(uid).collection("imports").doc();
  await importDoc.set({
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
    const batch = db.batch();
    for (const p of positions.slice(i, i + BATCH_LIMIT)) {
      const ref = importDoc.collection("positions").doc();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...data } = p;
      batch.set(ref, data);
    }
    await batch.commit();
  }
  return importDoc.id;
}

// ---------------------------------------------------------------------------
// Regras de classificação
// ---------------------------------------------------------------------------

export async function getRules(
  uid: string,
): Promise<Record<string, InstrumentRule>> {
  const snap = await userRef(uid).collection("instrumentRules").get();
  const rules: Record<string, InstrumentRule> = {};
  snap.docs.forEach((d) => (rules[d.id] = d.data() as InstrumentRule));
  return rules;
}

/**
 * Salva regra de classificação para um instrumento e aplica às posições
 * correspondentes no import informado (espelha saveRule do app).
 */
export async function saveRule(
  uid: string,
  key: string,
  rule: InstrumentRule,
  importId?: string,
): Promise<number> {
  const docId = encodeURIComponent(key);
  await userRef(uid)
    .collection("instrumentRules")
    .doc(docId)
    .set({ key, ...rule }, { merge: true });

  if (!importId) return 0;
  const snap = await userRef(uid)
    .collection("imports")
    .doc(importId)
    .collection("positions")
    .where("instrumentKey", "==", key)
    .get();

  let n = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) {
      batch.update(d.ref, {
        ...(rule.assetClass ? { assetClass: rule.assetClass } : {}),
        ...(rule.productType ? { productType: rule.productType } : {}),
      });
      n++;
    }
    await batch.commit();
  }
  return n;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getTargets(uid: string): Promise<Targets | null> {
  const d = await userRef(uid).collection("settings").doc("targets").get();
  return d.exists ? (d.data() as Targets) : null;
}

export async function saveTargets(
  uid: string,
  targets: Targets,
): Promise<void> {
  await userRef(uid)
    .collection("settings")
    .doc("targets")
    .set(targets, { merge: true });
}

export async function getRetirement(
  uid: string,
): Promise<RetirementPlan | null> {
  const d = await userRef(uid).collection("settings").doc("retirement").get();
  return d.exists ? (d.data() as RetirementPlan) : null;
}

export async function saveRetirement(
  uid: string,
  plan: Partial<RetirementPlan>,
): Promise<void> {
  await userRef(uid)
    .collection("settings")
    .doc("retirement")
    .set(plan, { merge: true });
}

export async function getWealth(uid: string): Promise<WealthYear[]> {
  const d = await userRef(uid).collection("settings").doc("wealth").get();
  const data = d.exists ? (d.data() as { years?: WealthYear[] }) : null;
  return data?.years ?? [];
}

export async function saveWealth(
  uid: string,
  years: WealthYear[],
): Promise<void> {
  await userRef(uid)
    .collection("settings")
    .doc("wealth")
    .set({ years }, { merge: true });
}
