import { useEffect, useState } from "react";
import { Copy, KeyRound, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../hooks/useAuth";
import { useRules } from "../hooks/usePortfolio";
import {
  createMcpToken,
  deleteMcpToken,
  deleteRule,
  subscribeMcpTokens,
  type McpTokenMeta,
} from "../lib/firestore";
import { formatDate } from "../lib/format";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";

const MCP_URL = "https://alloca-mcp-1038890628386.us-central1.run.app/mcp";

export function ConfiguracoesPage() {
  const { user, logout } = useAuth();
  const { rules, loading } = useRules();
  const [removing, setRemoving] = useState<string | null>(null);
  const [tokens, setTokens] = useState<McpTokenMeta[]>([]);
  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeMcpTokens(user.uid, setTokens);
  }, [user]);

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

  async function generate() {
    if (!user) return;
    setGenerating(true);
    try {
      setNewToken(await createMcpToken(user.uid));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar chave");
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(id: string) {
    if (!user) return;
    setRevoking(id);
    try {
      await deleteMcpToken(user.uid, id);
      toast.success("Chave revogada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao revogar chave");
    } finally {
      setRevoking(null);
    }
  }

  async function copyConnectorUrl() {
    if (!newToken) return;
    await navigator.clipboard.writeText(`${MCP_URL}?token=${newToken}`);
    toast.success("URL do conector copiada");
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
          subtitle="Conecte IAs (Claude, ChatGPT, Cursor…) à sua carteira — cada usuário usa a própria chave"
        />
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium">Suas chaves</p>
              <Button size="sm" onClick={generate} disabled={generating}>
                <KeyRound className="h-4 w-4" />
                {generating ? "Gerando…" : "Gerar nova chave"}
              </Button>
            </div>

            {newToken && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Copie agora — a chave não será exibida de novo
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs">
                    {MCP_URL}?token={newToken}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyConnectorUrl}>
                    <Copy className="h-4 w-4" /> Copiar
                  </Button>
                </div>
              </div>
            )}

            {tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma chave. Gere uma para conectar o ChatGPT ou outro
                cliente remoto.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {tokens.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-2">
                    <span className="font-mono text-sm">•••{t.hint}</span>
                    <span className="flex-1 text-xs text-muted-foreground">
                      criada em {formatDate(t.createdAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoking === t.id}
                      onClick={() => revoke(t.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 font-medium">Conectar no ChatGPT</p>
            <ol className="mb-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                No ChatGPT: Configurações → Segurança e login → ative o{" "}
                <strong className="font-medium text-foreground">
                  Modo de desenvolvedor
                </strong>
              </li>
              <li>
                Abra <strong className="font-medium text-foreground">Plugins</strong>{" "}
                e clique no botão <strong className="font-medium text-foreground">+</strong>{" "}
                para criar a conexão MCP
              </li>
              <li>Cole a URL abaixo já com a sua chave gerada acima</li>
              <li>
                Selecione{" "}
                <strong className="font-medium text-foreground">Sem autenticação</strong>{" "}
                — a chave já vai na própria URL
              </li>
            </ol>
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
{`${MCP_URL}?token=<sua-chave>`}
            </pre>
          </div>

          <p className="text-xs text-muted-foreground">
            A chave identifica você — cada usuário acessa apenas os próprios
            dados. Revogue uma chave a qualquer momento nesta página.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
