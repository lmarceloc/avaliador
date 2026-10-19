# Workflow n8n: Busca de Imóveis

Arquivo para importar: **`busca-imoveis.workflow.json`**. Ele é gerado por `node build.mjs`; não edite o JSON à mão.

## Endpoints

| Método | Caminho | O que faz |
|---|---|---|
| `POST` | `/webhook/buscar-imoveis` | Valida, consulta o cache (6 h) e responde na hora com `status: "processando"`. Depois coleta e grava o resultado no Supabase (`buscas`). Se houver cache, responde direto com o resultado completo. |
| `GET` | `/webhook/resultados?requisicao_id=<uuid>` | Devolve `processando` (com `fontes[]`) enquanto a coleta roda e o resultado completo quando termina. |

Os dois endpoints exigem o header `X-API-Key`.

## Importar e ativar

1. Em **Workflows → Import from file**, escolha `busca-imoveis.workflow.json`.
2. Crie as duas credenciais e selecione-as nos nós (o import mostra um aviso nos nós sem credencial):
   - **Header Auth** chamada `X-API-Key – Busca de Imóveis`, com Name = `X-API-Key` e Value = uma chave longa e aleatória. Use essa credencial nos dois nós Webhook.
   - **Supabase API** chamada `Supabase – Busca de Imóveis`, com Host = `https://zbpgxziqmoupfpkbifla.supabase.co` e Service Role Secret = a chave `service_role`. Use essa credencial nos 5 nós HTTP (Consultar cache, Gravar…, Ler busca).
3. Ative o workflow.
4. No front, edite `web/.env.local`:
   ```
   N8N_BASE_URL=https://seu-n8n.exemplo.com.br
   N8N_API_KEY=<a mesma chave do Header Auth>
   ```
   Reinicie o `npm run dev`. Sem `N8N_BASE_URL`, o front volta ao backend simulado.

## Teste rápido via curl

```bash
ID=$(uuidgen)
curl -s -X POST "$N8N/webhook/buscar-imoveis" -H "X-API-Key: $CHAVE" -H "Content-Type: application/json" -d '{
  "requisicao_id":"'$ID'","cidade":"Ponta Grossa","uf":"PR","fontes":["flow","kikina"],"atualizar_cache":true,
  "filtros":{"tipos":["casa"],"bairros":["Órfãs"],"area_construida":{"min":100,"max":300},"area_terreno":{"min":null,"max":null},
  "preco_total":{"min":null,"max":1500000},"dormitorios_min":3,"suites_min":null,"banheiros_min":null,"vagas_min":null,
  "condominio":"indiferente","pavimentos":{"min":null,"max":null}}}'
# ~40-60 s depois:
curl -s "$N8N/webhook/resultados?requisicao_id=$ID" -H "X-API-Key: $CHAVE" | head -c 600
```

## Fontes

Testadas em 14/10/2026 pelo n8n de produção: 9 fontes em paralelo terminaram em cerca de 72 s.

| Fonte | Plataforma | Como coleta | Observações |
|---|---|---|---|
| Flow, Adquira, Conceito, Taques | SysOne | HTML `/busca/venda/tipo_casa/cidade_ponta-grossa/bairro_x/valormax_y/mostrar_100` + anúncio para a galeria | Um conector só (`criarConectorSysOne`). A Adquira usa o tema de card "v3". |
| Kikina | CasaSoft | API JSON que o próprio site usa + anúncio para a galeria | |
| Casa Top | Jetimob (Next.js) | `__NEXT_DATA__` da listagem, que já traz todas as fotos | Não abre anúncio; é a coleta mais rápida. |
| Clássica | Techbins (Next.js) | Sitemap `/sitemap/property` + dados embutidos no anúncio | O robots.txt proíbe `/api/`, então a listagem não é usada além da 1ª página. Muitos anúncios não publicam área construída. |
| Montoro | Imobland (mesmo `__NEXT_DATA__` da Casa Top) | `/imoveis?type=Casa&operation=sale&page=N`; os dados e as fotos já vêm na listagem | Não publica logradouro nem área do terreno; vários anúncios só trazem preço, fotos e bairro. |
| Madol | Praedium | JSON-LD dos cards em `/imoveis/a-venda/ponta-grossa-pr/{bairro}?pagina=N` + anúncio | Tem WAF com captcha: ritmo de 2 s e no máximo 25 anúncios por busca. Se bloquear, a fonte volta "verificação humana" e as outras seguem. As fotos "exclusivas" (atrás de cadastro) não são coletadas. |
| Tavarnaro | Kurole | HTML em ISO-8859-1 `/comprar/Ponta-Grossa/{Casa,Sobrado,…}?pag=N` + anúncio | Não publica logradouro. |
| Aspen | Imonov/si9 | HTML `/filtro2/list/venda/{tipo}/todas/todos/{min}-{max}/todos/todos/{pag}` + anúncio | O site expõe credenciais do si9 no JS público. **Não são usadas.** Vale avisar a imobiliária. |

O robots.txt de todos permite as páginas usadas. Antes de produção, ainda é preciso conferir os termos de uso de cada site (seção 9).

## Atualizar o workflow no n8n pelo MCP

`node gerar-sdk.mjs <workflowId> <credencial Supabase> <credencial Header Auth>` gera `build/workflow-sdk.js`. Esse arquivo vai para `validate_workflow`, depois `update_workflow` e por fim `publish_workflow` no MCP do n8n. O n8n manteve as credenciais já ligadas aos nós, mas convém conferir com um GET em `/webhook/resultados`. Se algo quebrar, republique a versão anterior com `publish_workflow` passando `versionId`.

## Limites e configuração

Ficam no topo do nó **Coletar e processar**:

- `TIMEOUT_FONTE_MS = 120000`. A especificação pede 25 s, mas abrir a página de cada anúncio para pegar a galeria completa leva de 15 a 60 s por fonte. As fontes rodam em paralelo.
- `CONFIG_FONTES`: ajustes por fonte de `max_paginas` (padrão 10), `max_detalhes` (padrão 50) e `intervalo_ms` (padrão 1000).
  - Imóveis além de `max_detalhes` vêm só com a foto de capa e com `detalhe_coletado: false`; o front avisa no detalhe.
  - Os detalhes abertos primeiro são os dos imóveis que não reprovam em nenhum critério.
- O nó Code roda no task runner, que por padrão tem 300 s de limite (`N8N_RUNNERS_TASK_TIMEOUT`). Esse limite sobra para 2 a 3 fontes.

## Desenvolvimento

```bash
cd web && npx esbuild src/lib/regras.ts --bundle --format=esm --target=es2020 --outfile=../n8n/build/regras.esm.js
cd ../n8n
node testar.mjs          # conectores reais, sem n8n
node build.mjs           # gera o JSON
set -a; . ../web/.env.local; set +a; node simular.mjs   # fluxo completo + Supabase, sem n8n
```

As regras de negócio (filtros, deduplicação, outliers) vêm de `web/src/lib/regras.ts`, o mesmo código usado pelo front simulado.
