# Plano A

Gestão de investimentos com estratégia de asset allocation. Importa a planilha
"Posição Detalhada" da XP Investimentos, categoriza por classe de ativo e tipo
de produto, e compara a carteira atual com a carteira ideal.

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
