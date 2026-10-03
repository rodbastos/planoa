import { useEffect, useState } from "react";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../hooks/useAuth";
import { deleteImport, subscribeImports } from "../lib/firestore";
import type { ImportMeta } from "../lib/types";
import { formatBRL, formatTimestamp } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { PageLoader } from "../components/ui/StatCard";

export function HistoricoPage() {
  const { user } = useAuth();
  const [imports, setImports] = useState<ImportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<ImportMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    return subscribeImports(user.uid, (list) => {
      setImports(list);
      setLoading(false);
    });
  }, [user]);

  async function confirmDelete() {
    if (!user || !toDelete) return;
    setDeleting(true);
    try {
      await deleteImport(user.uid, toDelete.id);
      toast.success("Importação removida");
      setToDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Histórico de importações</h1>
        <p className="text-sm text-muted-foreground">
          A carteira exibida é sempre o snapshot mais recente.
        </p>
      </div>

      {imports.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhuma importação ainda.
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {imports.map((imp, i) => (
            <div
              key={imp.id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-muted/30"
            >
              <div className="rounded-lg bg-muted p-2.5 text-accent">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{imp.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {imp.referenceDate
                    ? `dados de ${formatTimestamp(imp.referenceDate)}`
                    : formatTimestamp(imp.uploadedAt)}{" "}
                  · {imp.positionCount} posições
                </p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold">
                  {formatBRL(imp.patrimonio)}
                </p>
                <p className="text-xs text-muted-foreground">patrimônio</p>
              </div>
              {i === 0 && (
                <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                  atual
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setToDelete(imp)}
                title="Excluir importação"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Dialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Excluir importação"
        footer={
          <>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              Excluir
            </Button>
          </>
        }
      >
        <p>
          Excluir <strong>{toDelete?.fileName}</strong> de{" "}
          {toDelete && formatTimestamp(toDelete.uploadedAt)} e suas{" "}
          {toDelete?.positionCount} posições? Esta ação não pode ser desfeita.
        </p>
      </Dialog>
    </div>
  );
}
