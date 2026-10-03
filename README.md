# Plano A

Gestão de investimentos com estratégia de asset allocation. Importa a planilha
"Posição Detalhada" da XP Investimentos, categoriza por classe de ativo e tipo
de produto, e compara a carteira atual com a carteira ideal.

## Funcionalidades

### Autenticação e dados
- Login com Google (Firebase Auth); todas as rotas são protegidas
- Dados isolados por usuário no Firestore (importações, posições, regras,
  carteira ideal, plano de aposentadoria)

### Importação (`/importar`)
- Upload do relatório "Posição Detalhada" da XP (.xlsx) por drag-and-drop
  ou seletor de arquivo
- Parser que reconhece as seções da planilha (Ações, Tesouro Direto, Renda
  Fixa, COE, Fundos de Investimento, Previdência, Fundos Imobiliários etc.)
  e extrai patrimônio, total investido, saldo disponível e a data de
  referência do relatório
- Pré-visualização antes de confirmar: totais, alocação por classe e tipo,
  lista de posições detectadas e avisos de leitura
- Cada importação gera um snapshot — o histórico completo é preservado

### Classificação automática
- Taxonomia própria de classes de ativo (Pós-Fixado CDI, Prefixado,
  IPCA Médio, IPCA Longo, Renda Variável Brasil/Global) e tipos de produto
  (Tesouro Direto, Títulos Públicos/Privados, Ações, ETF, Fundos, COE,
  Previdência…)
- Heurísticas por seção da planilha, ticker e nome do ativo; "IPCA"
  genérico é dividido em Médio/Longo conforme o prazo até o vencimento
- Reclassificação manual cria uma regra por instrumento, persistida e
  reaplicada automaticamente nas próximas importações

### Dashboard (`/`)
- Cards de patrimônio, rentabilidade sobre o investido, total investido,
  saldo disponível e número de posições
- Donut de alocação por classe de ativo e barras por tipo de produto
- Resumo dos maiores desvios da carteira ideal, com quanto aplicar ou
  resgatar em cada classe

### Carteira (`/carteira`)
- Lista completa das posições com saldo, % de alocação, quantidade,
  rentabilidade e vencimento
- Agrupamento por classe de ativo, tipo de produto ou seção da planilha;
  itens ordenados por vencimento e saldo
- Busca por nome/ticker e filtros por classe e tipo
- Edição inline de classe e tipo de cada ativo (vira regra permanente)

### Carteira Ideal (`/carteira-ideal`)
- Editor de alocação alvo em %, separado por classe de ativo e por tipo de
  produto, com validação de soma = 100%
- Gráfico comparativo Atual vs Ideal
- Tabela de rebalanceamento: alocação atual e alvo em % e R$, indicando
  quanto aplicar ou resgatar por categoria

### Simulação de aposentadoria (`/simulacao`)
- Plano parametrizável: rentabilidade nominal anual, inflação esperada,
  idade atual, idade de início dos resgates, expectativa de vida, valor
  inicial, aporte mensal e renda passiva desejada — salvo na nuvem
- Projeção do patrimônio em valores reais (rentabilidade nominal
  descontada da inflação) nas fases de acumulação e de resgate
- Métricas: patrimônio acumulado na aposentadoria, taxa anual de retirada,
  idade em que o patrimônio se esgota (ou "não se esgota")
- Coast FIRE: quanto bastaria ter hoje para nunca mais aportar e em quanto
  tempo esse ponto é atingido
- Upload de CSV anual de patrimônio (modelo para download): com aportes e
  rendimentos separados por ano, estima a trajetória observada da carteira
  e a projeta lado a lado com o plano
- Gráfico combinando histórico real, continuação estimada e cenário
  planejado, com marcadores de início dos resgates e fim do patrimônio

### Histórico (`/historico`)
- Lista de todas as importações com data de referência, número de posições
  e patrimônio
- Seletor de snapshot disponível em todas as páginas para comparar
  qualquer importação passada
- Exclusão de importações com diálogo de confirmação

### Configurações (`/configuracoes`)
- Dados da conta e logout
- Gerenciamento das regras de classificação (listar e remover overrides)

### Interface
- Tema claro/escuro persistido, sidebar retrátil e layout responsivo com
  drawer no mobile
- Gráficos com Recharts, toasts de feedback e formatação pt-BR (R$, %,
  datas)

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS v4
- Firebase: Auth (Google), Firestore, Hosting — projeto `plano-alloca`
- SheetJS (xlsx), Recharts, React Router, sonner, lucide-react

## Setup

1. `npm install`
2. No [console do Firebase](https://console.firebase.google.com) → projeto
   **plano-alloca**:
   - **Authentication** → habilitar provedor **Google**
   - **Firestore Database** → criar banco (modo produção)
   - **Configurações do projeto → Seus apps** → registrar app Web e copiar as
     credenciais para o `.env` (use `.env.example` como referência)
3. `npm run dev` → http://localhost:5173

## Comandos

| comando            | ação                          |
| ------------------ | ----------------------------- |
| `npm run dev`      | dev server                    |
| `npm test`         | testes do parser (vitest)     |
| `npm run build`    | typecheck + build em `dist/`  |
| `firebase deploy`  | deploy hosting + rules        |

## Deploy

```
npm install -g firebase-tools
firebase login
npm run build
firebase deploy
```

## Estrutura de dados (Firestore)

```
users/{uid}/
  imports/{importId}              # snapshot: data, arquivo, totais
    positions/{positionId}        # posições do snapshot
  instrumentRules/{key}           # overrides de classificação por instrumento
  settings/targets                # carteira ideal (por classe e por tipo)
```
