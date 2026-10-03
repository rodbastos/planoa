const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const pct = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatBRL(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return brl.format(value);
}

export function formatPct(fraction: number | undefined | null): string {
  if (fraction === undefined || fraction === null || Number.isNaN(fraction))
    return "—";
  return pct.format(fraction);
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(
    value,
  );
}

/** "R$ 1.281.271,32" -> 1281271.32 ; also handles plain numbers */
export function parseBRL(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned || cleaned === "-") return undefined;
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

/** "9,68%" -> 0.0968 ; "1.090" (thousand-sep pt-BR) -> 1090 */
export function parsePercent(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[%\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : n / 100;
}

/** "1.090" -> 1090 ; "43,13" -> 43.13 ; 27138 -> 27138 */
export function parseQuantity(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/\./g, "");
  const n = Number(normalized);
  return Number.isNaN(n) ? undefined : n;
}

/** "15/05/2029" -> "2029-05-15" (ISO); keeps unparseable raw strings */
export function parseDateBR(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return value.trim() || undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function formatDateISO(iso: string | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
