# alloca-mcp

Servidor MCP do Plano A — permite que IAs (Claude, ChatGPT, Devin etc.)
leiam e escrevam dados da carteira direto no Firestore, reaproveitando a
mesma lógica do app (`src/lib/`): parser do relatório XP, classificação,
alocação, simulação de aposentadoria e CSV patrimonial.

## Tools

### Leitura

| tool | retorna |
| --- | --- |
| `list_snapshots` | todas as importações (data, arquivo, patrimônio, nº de posições) |
| `get_positions` | posições de um snapshot (mais recente por padrão) |
| `get_asset_allocation` | alocação por classe/tipo em R$ e %, com delta vs carteira alvo |
| `get_target_allocation` | carteira alvo salva |
| `get_performance` | rentabilidade: patrimônio vs investido, yield por posição, evolução entre snapshots |
| `get_maturities` | vencimentos ordenados, com dias restantes (filtro `withinDays`) |
| `get_wealth_history` | histórico patrimonial anual (CSV da XP) |
| `get_retirement_plan` | parâmetros do plano de aposentadoria |
| `run_retirement_simulation` | projeção + taxa de retirada + depletion + Coast FIRE (aceita `overrides`) |

### Escrita

| tool | efeito |
| --- | --- |
| `set_target_allocation` | define alvo por classe e/ou tipo (cada mapa deve somar 100) |
| `update_retirement_plan` | merge parcial dos parâmetros do plano |
| `set_instrument_classification` | cria regra de classe/tipo por instrumento e aplica ao snapshot |
| `upload_current_allocation` | novo snapshot: `xlsxBase64` (parser da XP + regras) ou `positions`+`meta` |
| `upload_annual_csv` | substitui o histórico patrimonial pelo CSV anual da XP |

> **Atenção:** a service account ignora as regras do Firestore — qualquer
> cliente conectado a este servidor pode ler **e escrever** na carteira.
> No modo HTTP, defina sempre `MCP_AUTH_TOKEN`.

## Setup

```bash
cd mcp
npm install
cp .env.example .env
```

1. **Service account** — console.firebase.google.com → projeto
   `plano-alloca` → Configurações → Contas de serviço → "Gerar nova chave
   privada". Salve o JSON como `mcp/service-account.json`
   (já está no `.gitignore`) ou aponte `GOOGLE_APPLICATION_CREDENTIALS`.
2. **Usuário** — `ALLOCA_UID` (Authentication → Users) ou
   `ALLOCA_USER_EMAIL` no `.env`.

## Uso local (stdio) — Claude Desktop, Cursor, Devin

`npm start` roda em stdio. Exemplo de config do cliente:

```json
{
  "mcpServers": {
    "alloca": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "C:/Users/rodri/alloca/mcp",
      "env": { "ALLOCA_UID": "SEU_UID" }
    }
  }
}
```

(Com o `.env` preenchido, o bloco `env` é opcional.)

## Uso remoto (HTTP) — ChatGPT

O ChatGPT só acessa MCPs por HTTPS público. Rode local e exponha com túnel:

```bash
cd mcp
npm run start:http            # http://localhost:8787/mcp
cloudflared tunnel --url http://localhost:8787
# ou: ngrok http 8787
```

No ChatGPT (Developer mode → conector MCP personalizado), use a URL do
túnel: `https://<seu-subdominio>.trycloudflare.com/mcp?token=<MCP_AUTH_TOKEN>`.

- `MCP_AUTH_TOKEN` protege o endpoint: aceita `Authorization: Bearer` ou
  `?token=` na URL (o ChatGPT não envia headers — use o token na URL).
- O modo HTTP é **stateless**: cada request cria uma sessão nova; não há
  persistência de conexão entre chamadas.
- `GET /health` responde `{ "ok": true }` para checar o túnel.

## Deploy no Cloud Run (sempre online)

Em vez do túnel, o servidor pode ficar sempre no ar no Cloud Run — sem
depender do PC ligado. No Cloud Run a credencial é a **service account
anexada ao serviço** (não precisa do JSON): o servidor usa
`applicationDefault()` automaticamente.

```bash
# pré-requisito: gcloud auth login + billing ativo no projeto plano-alloca
gcloud config set project plano-alloca

# 1. APIs (uma vez)
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

# 2. Repositório Docker (uma vez)
gcloud artifacts repositories create alloca-mcp \
  --repository-format=docker --location=us-central1

# 3. Build da imagem (rode da RAIZ do repo — o contexto inclui src/lib)
gcloud builds submit --config mcp/cloudbuild.yaml .

# 4. Deploy (--allow-unauthenticated é necessário: o ChatGPT não faz auth
#    do Google; a proteção fica por conta do MCP_AUTH_TOKEN)
gcloud run deploy alloca-mcp \
  --image us-central1-docker.pkg.dev/plano-alloca/alloca-mcp/alloca-mcp:latest \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account firebase-adminsdk-fbsvc@plano-alloca.iam.gserviceaccount.com \
  --set-env-vars "ALLOCA_UID=SEU_UID,MCP_AUTH_TOKEN=SEU_SEGREDO" \
  --memory 512Mi --min-instances 0 --max-instances 2
```

No ChatGPT (Developer mode → conector MCP):

`https://alloca-mcp-1038890628386.us-central1.run.app/mcp?token=<MCP_AUTH_TOKEN>`

O token está configurado como env var do serviço — veja/edite em
`gcloud run services describe alloca-mcp --region us-central1` ou
`--update-env-vars MCP_AUTH_TOKEN=novo` para rotacionar.

**Custo estimado: ~US$ 0/mês** para uso pessoal — ver seção de custos
abaixo. Para redeploy após mudanças: repita os passos 3 e 4.

### Custos (us-central1, uso pessoal estimado)

| item | estimativa de uso | custo |
| --- | --- | --- |
| Requests Cloud Run | ~1–2 mil/mês | $0 — free tier é 2 milhões/mês |
| vCPU + memória | ~ms por request, 512Mi | $0 — free tier: 180k vCPU-s + 360k GiB-s/mês |
| Cloud Build | alguns builds/mês | $0 — 120 min/dia grátis |
| Artifact Registry | imagem ~250 MB | $0 — 0,5 GB grátis |
| Firestore | leituras pontuais | $0 — 50k leituras/dia grátis |
| **Total esperado** | | **≈ $0/mês** (no pior caso, centavos) |

Com `--min-instances 0` a instância dorme entre requests (cold start de
~2–4 s na primeira chamada — aceitável para MCP). Não use min-instances ≥1:
manter 512Mi sempre alocada custa ~US$ 2–4/mês e não resolve nada aqui.

## Variáveis de ambiente

| var | obrigatória | descrição |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | uma das credenciais | caminho do service-account.json |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | uma das credenciais | JSON da service account inline |
| `ALLOCA_UID` | uma das duas | uid do Firebase Auth |
| `ALLOCA_USER_EMAIL` | uma das duas | e-mail Google → resolve o uid via Admin Auth |
| `FIREBASE_PROJECT_ID` | se não vier na SA | default: `VITE_FIREBASE_PROJECT_ID` do `.env` do app |
| `PORT` | não | porta HTTP (default 8787) |
| `MCP_AUTH_TOKEN` | recomendado p/ HTTP | bearer token / `?token=` |
| `MCP_TRANSPORT` | não | `http` força modo HTTP (mesmo que `--http`) |
