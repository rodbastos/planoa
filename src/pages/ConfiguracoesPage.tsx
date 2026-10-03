import { useState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../hooks/useAuth";
import { useRules } from "../hooks/usePortfolio";
import { deleteRule } from "../lib/firestore";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";

export function ConfiguracoesPage() {
  const { user, logout } = useAuth();
  const { rules, loading } = useRules();
  const [removing, setRemoving] = useState<string | null>(null);

  const entries = Object.entries(rules).sort(([a], [b]) => a.localeCompare(b));

  async function remove(key: string) {
    if (!user) return;
    setRemoving(key);
    try {
      await deleteRule(user.uid, key);
      toast.success(`Regra de "${key}" removida`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover regra");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
      </div>

      <Card>
        <CardHeader title="Conta" />
        <CardContent className="flex items-center gap-4">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="h-12 w-12 rounded-full" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-bold text-white">
              {user?.displayName?.[0] ?? "?"}
            </div>
          )}
          <div className="flex-1">
            <p className="font-medium">{user?.displayName}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="outline" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Regras de classificação"
          subtitle="Overrides manuais aplicados a cada instrumento na importação"
        />
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma regra. Reclassifique ativos na página Carteira para criar
              regras automáticas.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map(([key, rule]) => (
                <div key={key} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">
                    {key}
                  </span>
                  {rule.assetClass && <Badge>{rule.assetClass}</Badge>}
                  {rule.productType && <Badge>{rule.productType}</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removing === key}
                    onClick={() => remove(key)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Acesso via MCP"
          subtitle="Conecte IAs (Claude, ChatGPT, Cursor…) à sua carteira pelo servidor em mcp/"
        />
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="mb-1.5 font-medium">Clientes locais (stdio)</p>
            <p className="mb-2 text-muted-foreground">
              Registre o servidor na config do cliente — ele sobe
              automaticamente quando o app de IA abre:
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
{`{
  "mcpServers": {
    "alloca": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "<raiz-do-repo>/mcp"
    }
  }
}`}
            </pre>
          </div>

          <div>
            <p className="mb-1.5 font-medium">ChatGPT (HTTP remoto)</p>
            <p className="mb-2 text-muted-foreground">
              Suba o servidor em modo HTTP e exponha via túnel ou Cloud Run:
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
{`cd mcp && npm run start:http        # localhost:8787/mcp
cloudflared tunnel --url http://localhost:8787`}
            </pre>
            <p className="mt-2 text-muted-foreground">
              No conector do ChatGPT, use{" "}
              <code className="rounded bg-muted/50 px-1 font-mono text-xs">
                https://&lt;url&gt;/mcp?token=&lt;MCP_AUTH_TOKEN&gt;
              </code>
              . Para ficar sempre online sem o PC ligado, faça deploy no
              Cloud Run — comandos e custos em{" "}
              <code className="rounded bg-muted/50 px-1 font-mono text-xs">
                mcp/README.md
              </code>
              .
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Tools disponíveis: posições, snapshots, alocação, carteira alvo,
            rentabilidade, vencimentos, histórico, plano de aposentadoria e
            simulações — além de escrita (alvo, plano, regras e uploads).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
