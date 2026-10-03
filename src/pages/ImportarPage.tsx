import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Bot, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../hooks/useAuth";
import { useRules } from "../hooks/usePortfolio";
import { applyRules } from "../lib/classification";
import { saveImport } from "../lib/firestore";
import { groupBy } from "../lib/allocation";
import type { ParsedSpreadsheet } from "../lib/types";
import { formatBRL, formatPct } from "../lib/format";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/StatCard";
import { categoryColor } from "../lib/colors";
import { cn } from "../lib/utils";

export function ImportarPage() {
  const { user } = useAuth();
  const { rules } = useRules();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setParseError(null);
      setParsed(null);
      setFileName(file.name);
      try {
        const buf = await file.arrayBuffer();
        const { parseSpreadsheet } = await import("../lib/xlsx-parser");
        const result = parseSpreadsheet(new Uint8Array(buf));
        if (result.positions.length === 0) {
          setParseError(
            "Nenhuma posição encontrada. Verifique se é o relatório 'Posição Detalhada' da corretora.",
          );
          return;
        }
        setParsed(result);
      } catch (e) {
        setParseError(
          e instanceof Error ? e.message : "Falha ao ler o arquivo",
        );
      }
    },
    [],
  );

  const confirm = async () => {
    if (!user || !parsed || !fileName) return;
    setSaving(true);
    try {
      const positions = applyRules(parsed.positions, rules);
      await saveImport(user.uid, fileName, parsed, positions);
      toast.success(
        `${positions.length} posições importadas de "${fileName}"`,
      );
      navigate("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar importação");
      setSaving(false);
    }
  };

  const byClass = parsed ? groupBy(parsed.positions, "assetClass") : [];
  const byType = parsed ? groupBy(parsed.positions, "productType") : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Importar carteira</h1>
        <p className="text-sm text-muted-foreground">
          Envie o relatório "Posição Detalhada" (.xlsx) exportado da sua
          corretora. Cada importação cria um novo snapshot — o histórico é
          preservado.
        </p>
      </div>

      {/* dropzone */}
      <Card
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center border-2 border-dashed p-10 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Upload className="mb-3 h-10 w-10 text-accent" />
        <p className="font-medium">
          Arraste a planilha aqui ou clique para selecionar
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Formato: "Posição Detalhada" da XP (.xlsx)
        </p>
      </Card>

      <Card className="flex items-start gap-3 border-accent/30 bg-accent/5 p-4">
        <Bot className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="text-sm">
          <p className="font-medium">
            Ou importe por uma IA — de qualquer corretora
          </p>
          <p className="mt-1 text-muted-foreground">
            Não é cliente XP? Exporte a posição da sua corretora (planilha,
            PDF ou até print), envie para um agente de IA conectado ao MCP
            (gere sua chave em{" "}
            <Link to="/configuracoes" className="font-medium text-accent underline underline-offset-2">
              Configurações → Acesso via MCP
            </Link>
            ) e peça para subir os dados — ele usa a tool{" "}
            <code className="rounded bg-muted/50 px-1 font-mono text-xs">
              upload_current_allocation
            </code>{" "}
            com as posições estruturadas e cria um snapshot igual ao da
            planilha.
          </p>
        </div>
      </Card>

      {parseError && (
        <Card className="flex items-center gap-3 border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive">{parseError}</p>
        </Card>
      )}

      {parsed && (
        <>
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-accent" />
                  {fileName}
                </span>
              }
              subtitle="Pré-visualização — confira antes de confirmar"
            />
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <PreviewStat label="Patrimônio" value={formatBRL(parsed.patrimonio)} />
                <PreviewStat label="Investido" value={formatBRL(parsed.totalInvestido)} />
                <PreviewStat label="Disponível" value={formatBRL(parsed.saldoDisponivel)} />
                <PreviewStat label="Posições" value={String(parsed.positions.length)} />
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Por classe de ativo
                </p>
                <div className="flex flex-wrap gap-2">
                  {byClass.map((s) => (
                    <Badge key={s.key} color={categoryColor(s.key)}>
                      {s.key} · {formatPct(s.pct)}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Por tipo de produto
                </p>
                <div className="flex flex-wrap gap-2">
                  {byType.map((s) => (
                    <Badge key={s.key} color={categoryColor(s.key)}>
                      {s.key} · {formatPct(s.pct)}
                    </Badge>
                  ))}
                </div>
              </div>

              {parsed.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {parsed.warnings.length} aviso(s) de leitura
                  </p>
                  <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                    {parsed.warnings.map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setParsed(null);
                    setFileName(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button onClick={confirm} disabled={saving}>
                  {saving ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                  Confirmar importação
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Posições detectadas" />
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Ativo</th>
                    <th className="px-3 py-2.5 font-medium">Seção</th>
                    <th className="px-3 py-2.5 font-medium">Classe</th>
                    <th className="px-3 py-2.5 font-medium">Tipo</th>
                    <th className="px-5 py-2.5 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.positions.map((p, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-5 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.sourceSection}
                      </td>
                      <td className="px-3 py-2">{p.assetClass}</td>
                      <td className="px-3 py-2">{p.productType}</td>
                      <td className="px-5 py-2 text-right font-medium">
                        {formatBRL(p.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-lg font-bold">{value}</p>
    </div>
  );
}
