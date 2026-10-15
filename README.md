# Busca de Imóveis: Ponta Grossa/PR (fase 1)

Front de busca de comparativos para a avaliadora. Ele reúne numa única grade os imóveis das imobiliárias,
com fotos, link direto para o anúncio e a verificação de cada filtro.

```
web/        Next.js 16 (App Router): front + rotas de API que fazem proxy para o n8n
supabase/   migrações: fontes, buscas (cache/jobs), avaliacoes_imovel, análise de fotos e triagem do Jev
```

O backend de coleta (workflows do n8n) entra **por último**. Até lá, o front roda contra um backend
simulado que segue o contrato da seção 5 da especificação.

## Rodar

```bash
cd web
cp .env.example .env.local   # tudo vazio = modo simulado
npm install
npm run dev                  # http://localhost:3000
```

Para ver o estado de erro parcial: `MOCK_FONTES_COM_FALHA=kikina npm run dev`.

## Como o front fala com o backend

O navegador nunca chama o n8n direto. A chave `X-API-Key` fica só no servidor (seção 9).

| Rota do app | Com `N8N_BASE_URL` | Sem `N8N_BASE_URL` (simulado) |
|---|---|---|
| `POST /api/buscar` | `POST {n8n}/webhook/buscar-imoveis` | `src/lib/mock.ts` |
| `GET /api/resultados/:id` | `GET {n8n}/webhook/resultados/:id` | `src/lib/mock.ts` |
| `GET/PUT /api/avaliacoes` | tabela `avaliacoes_imovel` (Supabase) | `.data/avaliacoes.json` |

O front aceita os dois modos da seção 6.4. Se o `POST` voltar `status: "processando"`, ele consulta
`/resultados/:id` a cada 3 s e mostra o progresso por fonte (`fontes[].status` = `buscando` / `ok` / `erro`).
Se voltar o resultado completo, ele exibe direto.

## Regras de negócio

As regras ficam em [web/src/lib/regras.ts](web/src/lib/regras.ts), em funções puras e sem dependências:
normalização, preço/m², avaliação dos critérios (`atende` / `nao_atende` / `nao_verificado`), deduplicação
por código comum ou endereço + área + preço (±1%) e outliers (1,5 desvio padrão da mediana).
O backend simulado já usa essas funções. Ao montar o n8n, o pipeline `processarImoveis()` pode ser colado
num nó **Code** depois do "Juntar resultados".

## Modo de usar

1. **Buscar.** Escolha o tipo, os bairros e os filtros no painel e as fontes (imobiliárias). O app mostra uma grade de cards
   com foto, preço, preço/m², fonte e a verificação de cada filtro (✔ atende, ✖ não atende, ? não verificado).
2. **Filtrar a lista.** A barra acima da grade tem filtros rápidos (tipo, bairro, fonte, status) e a ordenação.
   Imóveis que não atendem aos filtros ficam ocultos até ligar "mostrar fora do filtro".
3. **Abrir o imóvel.** Clique no card para ver a galeria, os dados do anúncio e o link para o anúncio original.
4. **Sugestão da IA (opcional).** No bloco "Sugestão da IA (fotos)", clique em **Sugerir avaliação**. O sistema lê as fotos
   (até `FOTOS_MAX`), sugere o estado de conservação (IBAPE, A a I) e o padrão de acabamento (VEIU, 2.1 a 2.8) e a triagem
   do Jev diz se a sugestão precisa de revisão. A sugestão é só leitura e nunca é gravada sozinha.
5. **Análise da avaliadora.** Duas saídas:
   - **Concorda com a IA:** clique em **OK — usar na análise da avaliadora**. Os valores são copiados para o bloco de baixo
     e salvos, e a análise da IA fica marcada como aprovada.
   - **Discorda:** escolha os seus valores em "Análise da avaliadora" (estado de conservação e padrão VEIU),
     preencha as observações e clique em **Salvar análise**.
6. **Incluir na avaliação.** Em cada imóvel que vai para a planilha, clique em **Incluir na avaliação**
   (ou **Excluir da avaliação** para descartar).
7. **Exportar.** Use **CSV** ou **XLSX** no topo da lista. Sai **somente** o que está marcado como "Incluir na avaliação".
   Sem nenhum marcado, os botões ficam desativados.

### Colunas da planilha

`Nº`, `Endereço com nº`, `Bairro`, `Área construída (m²)`, `Área do terreno (m²)`, `Preço total (R$)`, `Preço/m² (R$)`,
`Pavimentos`, `Condomínio`, `Dormitórios`, `Suítes`, `Banheiros`, `Vagas cobertas`, `Vagas descobertas`, `Vagas total`,
`Padrão de acabamento (VEIU)`, `Idade`, `Estado IBAPE`, `Data do evento`, `Informante`, `Contato`, `Fonte de pesquisa`,
`Link do anúncio`.

## Perguntas frequentes

**Por que a análise lê só 6 (ou 10) fotos, e quais?**
O limite é a variável `FOTOS_MAX` (hoje 10; padrão do código 6). Não é sorteio: o sistema usa sempre a primeira foto (a capa,
que costuma ser a fachada) e distribui as demais em intervalos iguais, incluindo a última. Com limite 6: 4 ou 6 fotos usam todas;
10 fotos usam as posições 1, 3, 5, 6, 8, 10; 20 fotos usam 1, 5, 9, 12, 16, 20; 30 fotos usam 1, 7, 13, 18, 24, 30.
O nome do cômodo não vem na URL da foto, por isso a escolha é por posição. Para ler mais fotos, aumente `FOTOS_MAX`
(mais fotos deixam a análise mais lenta) e reinicie o servidor.

**O que significa "ignoradas: 1 — HTTP 403 no download"?**
O servidor da foto recusou o acesso, em geral porque a imobiliária bloqueia quem não vem do site dela. A foto é descartada,
o motivo é registrado no log e a análise segue com as demais (ex.: "5 de 20" lidas).

**Os campos "Padrão de acabamento" da IA e da avaliadora são diferentes?**
Não. Os dois gravam o mesmo campo (`avaliacoes_imovel.padrao_acabamento`, ex.: "2.5 Médio"). A IA só sugere; o que vale e
vai para a planilha é o que está salvo em "Análise da avaliadora".

**Por que a tela mostra menos "Incluídos" do que o resumo do topo?**
O resumo conta todos os imóveis incluídos da busca, mesmo os escondidos pelos filtros rápidos. Quando isso acontece o topo avisa,
por exemplo, "3 incluídos na avaliação (2 ocultos pelos filtros da tela)". Eles continuam indo para a planilha. Para vê-los,
ligue "mostrar fora do filtro" ou ajuste os filtros; para tirá-los da planilha, desmarque "Incluir na avaliação" em cada um.

**O que são as colunas "Data do evento" e "Informante"?**
- **Data do evento:** a data em que o anúncio foi publicado/incluído no site da imobiliária (dd/mm/aaaa). É a data da oferta,
  referência para o valor. Fica vazia quando a fonte não informa.
- **Informante:** o nome de quem passou a informação (corretor ou atendente responsável pelo anúncio), quando o site mostra.
  Ao lado fica o **Contato** (telefone). Algumas fontes só mostram o telefone da imobiliária e o Informante sai vazio;
  nesse caso a avaliadora pode preencher à mão.

**O que é um "Outlier"?**
Um imóvel cujo **preço por m²** está muito fora do normal da mesma busca, caro ou barato demais. A regra: calcula-se a mediana
e o desvio padrão do preço/m² de todos os imóveis; quem fica a **mais de 1,5 desvio padrão** da mediana ganha a etiqueta azul
"Outlier". Só vale com pelo menos 4 imóveis com preço/m². Pode ser erro de cadastro (área ou preço errado, aluguel no lugar
de venda) ou um imóvel realmente diferente (cobertura de luxo, terreno com construção antiga). É só um aviso: o imóvel não é
removido nem bloqueado e pode ser incluído e exportado normalmente. O filtro "Status" da tela mostra só os outliers.
A regra está em `web/src/lib/regras.ts` (`marcarOutliers`).

## Sugestão de avaliação por fotos

Duas camadas, ambas só no servidor (`web/src/server/`):

1. **Análise de fotos** (`analise-fotos.ts`): baixa as fotos (timeout de 15 s; só JPEG, PNG, WebP e GIF até 20 MB; só endereços
   públicos) e envia a um modelo de visão pelo **OpenRouter**. O modelo devolve `ec_classe` (IBAPE, A a I),
   `padrao_codigo` (VEIU, 2.1 a 2.8), justificativa e confiança. A depreciação e o valor Sisdia **sempre vêm das tabelas** de
   `web/src/config/avaliacao.ts`, nunca do modelo. Resposta inválida: uma nova tentativa; falhando de novo, status `erro`.
2. **Triagem em texto com o Jev** (`triagem-jev.ts`, API da TypeSafe): o Jev não vê imagens. Recebe só o resultado da análise
   (sem contato, preço, endereço nem URL de foto) e responde: precisa de revisão humana? a justificativa é coerente com a classe?
   nota de coerência de 1 a 5; e, se a confiança for baixa ou o padrão vier vazio, uma segunda opinião de padrão.
   Se o Jev falhar (timeout, 5xx, resposta fora do formato, sem chave), o resultado é "indisponível" e a revisão humana fica
   **obrigatória**: falta de resposta nunca é aprovação.

Nada é gravado em `avaliacoes_imovel` sem o clique da avaliadora. Cada foto gera uma linha em `analises_foto_log`, cada análise
uma linha em `analises_foto` e cada pergunta do Jev uma linha em `triagens_jev`. A resposta bruta dos modelos só é gravada com
`LOG_RESPOSTA_BRUTA=true`.

### Variáveis de ambiente (`web/.env.local`)

| Variável | Para que serve | Padrão |
|---|---|---|
| `OPENROUTER_API_KEY` | chave do OpenRouter (só servidor) | — |
| `OPENROUTER_MODEL` | modelo de visão (ex.: `openrouter/free`; confira o id em openrouter.ai/api/v1/models) | — |
| `FOTOS_MAX` | máximo de fotos por análise | 6 |
| `TYPESAFE_API_KEY` | chave do Jev (só servidor) | — |
| `JEV_MODEL` | modelo do Jev (use o id versionado, não `jev-latest`) | `jev-1.13.0` |
| `JEV_BASE_URL` | gateway opcional | padrão do SDK |
| `JEV_LIMITE_REVISAO` | P(precisa de revisão) acima disto → revisão obrigatória | 0,5 |
| `JEV_LIMITE_COERENCIA` | P(justificativa coerente) abaixo disto → revisão obrigatória | 0,5 |
| `JEV_NOTA_MINIMA` | nota de coerência (1 a 5) abaixo disto → revisão obrigatória | 3 |
| `JEV_TIMEOUT_MS` | timeout por tentativa (há 1 nova tentativa em timeout, 429 e 5xx) | 20000 |
| `LOG_RESPOSTA_BRUTA` | `true` grava a resposta bruta (só para depuração) | `false` |

Nunca coloque chaves no código nem no front. `.env.local` não vai para o git.

### Pendências de confirmação

- **Valor Sisdia:** os padrões 2.1, 2.2, 2.6 e 2.8 ainda não têm valor confirmado e aparecem como "a confirmar"
  (o valor 1 da escala também não tem padrão associado). Mapeados: 2.3→0, 2.4→2, 2.5→3, 2.7→4.
- **Migrações do Supabase:** aplicar `20261015120000_analise_fotos.sql` e `20261015130000_triagens_jev.sql`.
- **Limites da triagem:** os valores padrão (0,5 / 0,5 / 3) são pontos de partida e precisam ser calibrados com casos reais.

### Testes

```bash
cd web
npm test        # análise de fotos, triagem do Jev e regras de gravação
npx tsc --noEmit && npx eslint src test
```

## Pontos em aberto que afetam o código

- **Lista de bairros** ([web/src/lib/bairros.ts](web/src/lib/bairros.ts)): é provisória e precisa ser substituída pela oficial.
- **Autenticação**: hoje é Basic Auth opcional (`APP_USUARIO`/`APP_SENHA`), aplicada no `src/proxy.ts`.
- **Hospedagem**: o app é um Next.js padrão e roda tanto na Vercel quanto num container no EasyPanel (`npm run build && npm start`).
- **Coluna "Idade"** da planilha: nenhuma fonte publica esse dado, então ela sai vazia na exportação.
