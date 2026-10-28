# Backend do avaliador (VPS)

Serviço Node que substitui o n8n e o Supabase: coleta nas imobiliárias e guarda tudo num Postgres na própria
VPS. Só o servidor do site (Vercel) fala com ele, sempre com o header `X-API-Key`.

```
src/index.ts        sobe a API, aplica as migrações, encerra buscas órfãs e limpa cache e pesquisas vencidas de hora em hora
src/servidor.ts     rotas HTTP
src/buscas.ts       validação, cache de 6 h e coleta em segundo plano (era o workflow do n8n)
src/coleta.ts       roda os conectores e o pipeline de web/src/lib/regras.ts
src/conectores.js   conectores das 12 imobiliárias (mesmo código que rodava no nó Code do n8n)
src/avaliacoes.ts   análise da avaliadora
src/analises.ts     registros da sugestão por fotos (analises_foto, logs, triagens do Jev)
src/pesquisas.ts    pesquisas salvas (nome + resultados + seleção, 30 dias); regras em web/src/lib/pesquisas.ts
sql/                migrações, aplicadas sozinhas na subida (tabela schema_migracoes)
scripts/            importar-supabase.ts (cópia única dos dados) e testar-coleta.ts
```

## Rotas

| Rota | O que faz |
|---|---|
| `GET /saude` | `{"ok":true}` se o banco responde. Única rota sem chave. |
| `POST /buscas` | Valida e responde na hora: resultado do cache (6 h) ou `status: "processando"`. A coleta segue em segundo plano. |
| `GET /buscas/:id` | `processando` (com `fontes[]`), o resultado completo, ou `404` "Busca não encontrada ou expirada". |
| `GET /avaliacoes` · `PUT /avaliacoes` | Lista e grava a análise da avaliadora. |
| `POST /analises-foto` · `/analises-foto/logs` · `/analises-foto/triagens` | Grava a sugestão por fotos. |
| `POST /analises-foto/:id/aprovar` | Marca a sugestão como aprovada. |
| `GET /pesquisas` · `POST /pesquisas` | Lista as pesquisas salvas; cria uma a partir de uma busca concluída (`{ nome, requisicao_id, extras?, selecao? }`). |
| `GET /pesquisas/:id` · `PATCH` · `DELETE` | Abre (resultados + seleção); renomeia ou troca os resultados (`substituir` / `juntar`); apaga. |
| `PUT /pesquisas/:id/selecao` | `{ imovel_id, incluido: true \| false \| null }`. Toda alteração renova os 30 dias. |

Se o serviço reinicia no meio de uma coleta, a busca vira `erro` ("o serviço reiniciou") na próxima subida,
e o front para de esperar.

## Subir no EasyPanel

1. **Postgres.** No projeto, crie um serviço **Postgres** (ex.: `postgres`, banco `avaliador`).
   Não exponha a porta: o backend usa a rede interna. Copie a **Internal Connection URL**.
   Em **Backups**, configure um destino (S3 ou similar): o banco não tem backup automático fora disso.
2. **Backend.** Crie um serviço **App** (ex.: `backend`):
   - Source: o repositório do GitHub, branch `main`.
   - Build: **Dockerfile**, arquivo `backend/Dockerfile`, com o build path na **raiz** do repositório
     (o build precisa de `web/src/lib`).
   - Environment:
     ```
     DATABASE_URL=<Internal Connection URL do passo 1>
     API_KEY=<chave longa e aleatória; ex.: saída de  openssl rand -hex 32>
     PORT=3000
     ```
     Sem `PORT`, o EasyPanel passa `PORT=80`; o log mostra a porta em uso ("backend do avaliador na porta …").
   - Domains: um domínio HTTPS apontando para a **mesma porta** do `PORT` (3000). O padrão do EasyPanel serve,
     algo como `https://imoveis-backend.<seu-host>.easypanel.host`.
3. **Deploy** e confira `https://<domínio do backend>/saude` → `{"ok":true}`. As tabelas são criadas na primeira subida.
4. **Copiar os dados do Supabase** (uma vez; pode repetir sem duplicar). No **Console** do serviço backend:
   ```
   SUPABASE_URL=https://zbpgxziqmoupfpkbifla.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> node dist/importar-supabase.mjs
   ```
   Copia `avaliacoes_imovel`, `analises_foto`, `analises_foto_log` e `triagens_jev`. O cache de buscas não é copiado.
   O Supabase precisa estar ativo (não pausado) nessa hora.
5. **Vercel** (projeto `avaliador`): adicione `BACKEND_URL` (o domínio do passo 2, sem barra no fim) e
   `BACKEND_API_KEY` (a mesma `API_KEY`), apague `N8N_BASE_URL`, `N8N_API_KEY` e as três `SUPABASE_*`, e faça
   **Redeploy**.
6. Faça uma busca no site. Funcionando, **desative o workflow** "Busca de Imóveis" no n8n. O Supabase pode ficar
   pausado como cópia de segurança por um tempo e ser apagado depois.

## Desenvolvimento

```bash
cd backend
npm install
DATABASE_URL=postgres://... API_KEY=<24+ caracteres> npm run dev      # API em http://localhost:3000
DATABASE_URL_TESTE=postgres://.../avaliador_teste npm test             # APAGA o banco indicado
npm run typecheck
FONTES=flow,kikina npm run testar-coleta                                 # conectores reais, sem banco
```

No front, aponte `BACKEND_URL=http://localhost:3000` e `BACKEND_API_KEY` no `web/.env.local`.
