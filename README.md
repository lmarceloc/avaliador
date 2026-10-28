# Busca de Imóveis: Ponta Grossa/PR (fase 1)

Front de busca de comparativos para a avaliadora. Ele reúne numa única grade os imóveis das imobiliárias,
com fotos, link direto para o anúncio e a verificação de cada filtro.

```
web/        Next.js 16 (App Router), na Vercel: front + rotas de API que repassam ao backend
backend/    serviço Node na VPS (EasyPanel): coleta nas imobiliárias + banco Postgres
            (buscas com cache de 6 h, avaliacoes_imovel, análise de fotos e triagem do Jev)
```

Sem `BACKEND_URL`, o front roda contra uma busca simulada que segue o contrato da seção 5 da especificação.
Como subir o backend: [backend/README.md](backend/README.md).

## Rodar

```bash
cd web
cp .env.example .env.local   # tudo vazio = modo simulado
npm install
npm run dev                  # http://localhost:3000
```

Para ver o estado de erro parcial: `MOCK_FONTES_COM_FALHA=kikina npm run dev`.

## Publicar (Vercel)

O projeto da Vercel (time da Agência Byte, plano Hobby) acompanha `helloagenciabyte-max/avaliador`, branch `main`.
No Hobby só commits da própria conta da Byte publicam; um push direto de outro autor fica **Blocked**. Por isso:

1. Trabalhe numa branch e abra um pull request para `main`.
2. Com a conta **helloagenciabyte-max**, faça o merge escolhendo **Create a merge commit**. "Squash and merge" e
   "Rebase and merge" mantêm o autor original do commit e o deploy é bloqueado de novo.
3. O merge sai no nome da Byte e a Vercel publica a `main` sozinha.

O backend da VPS não passa pela Vercel: o EasyPanel gera a imagem a partir do mesmo repositório
(`backend/Dockerfile`). Depois de mudar `backend/` **ou `web/src/lib/`** (as regras vão embutidas no backend),
faça **Deploy** no serviço backend do EasyPanel, ou ligue o deploy automático dele. Passo a passo em
[backend/README.md](backend/README.md).

## Como o front fala com o backend

O navegador nunca chama o backend direto. A chave `X-API-Key` (`BACKEND_API_KEY`) fica só no servidor (seção 9).

| Rota do app | Com `BACKEND_URL` | Sem `BACKEND_URL` (simulado) |
|---|---|---|
| `POST /api/buscar` | `POST {backend}/buscas` | `src/lib/mock.ts` |
| `GET /api/resultados/:id` | `GET {backend}/buscas/:id` | `src/lib/mock.ts` |
| `GET/PUT /api/avaliacoes` | `GET/PUT {backend}/avaliacoes` | `.data/avaliacoes.json` |
| `POST/PATCH /api/analise-fotos` | grava em `{backend}/analises-foto…` | `.data/*.json` |

Se o backend não responder, as rotas devolvem `502` com a mensagem "O servidor de busca não respondeu",
que aparece na tela no lugar de um erro genérico.

### Login

Com `BACKEND_URL` configurado o login é obrigatório (`src/proxy.ts`): sem sessão, as páginas vão para `/login` e as rotas
de API respondem `401`. Os usuários ficam na tabela `usuarios` do Postgres (e-mail, nome, hash scrypt da senha, ativo).
O backend confere e-mail e senha (`POST /auth/login`, com bloqueio de 15 min após 5 erros seguidos) e o site grava a sessão
num cookie `HttpOnly`/`Secure`/`SameSite=Lax` assinado com `SESSAO_SEGREDO`, válido por 7 dias. Sem `SESSAO_SEGREDO` o site
fica fechado (503). No topo, o menu do usuário tem **Trocar senha** e **Sair**.

Cadastro (por enquanto pelo console do backend no EasyPanel; ver [backend/README.md](backend/README.md#usuários)):
`node dist/usuarios.mjs criar carina@exemplo.com "Carina Souza"` mostra uma senha gerada, que a pessoa troca no site.
Um cadastro pela tela inicial pode ser ligado depois: a tabela já tem `ativo` para contas aguardando aprovação.

O front aceita os dois modos da seção 6.4. Se o `POST` voltar `status: "processando"`, ele consulta
`/resultados/:id` a cada 3 s e mostra o progresso por fonte (`fontes[].status` = `buscando` / `ok` / `erro`).
Se voltar o resultado completo, ele exibe direto.

## Regras de negócio

As regras ficam em [web/src/lib/regras.ts](web/src/lib/regras.ts), em funções puras e sem dependências:
normalização, preço/m², avaliação dos critérios (`atende` / `nao_atende` / `nao_verificado`), deduplicação
por código comum ou endereço + área + preço (±1%) e outliers (1,5 desvio padrão da mediana).
A busca simulada e o backend da VPS usam essas mesmas funções: o build do backend embute este arquivo.

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
7. **Salvar a pesquisa.** Ao marcar o primeiro imóvel o app pede um nome (ex.: "Casa Adriana"); também dá para usar
   **Salvar pesquisa**. A pesquisa guarda os imóveis, os filtros e a seleção, e cada marcação seguinte é gravada na hora.
   Em **Pesquisas salvas** (no topo) dá para abrir, e o app volta direto na aba Selecionados, sem buscar de novo.
8. **Exportar.** Use **CSV** ou **XLSX** no topo da lista. Sai **somente** o que está marcado como "Incluir na avaliação"
   na pesquisa aberta. Sem nenhum marcado, os botões ficam desativados.

### Pesquisas salvas

- A seleção (incluído/excluído) é **de cada pesquisa**: "Casa Adriana" e "Apartamento Joana" não se misturam. A análise da
  avaliadora (estado IBAPE, padrão, observações) continua sendo **do imóvel** e aparece em qualquer pesquisa em que ele estiver.
- Validade: **30 dias desde a última alteração** (nome, resultados ou seleção). Depois disso o backend apaga.
- Pesquisar de novo com uma pesquisa aberta pergunta se os resultados são para ela (os já incluídos/excluídos continuam) ou
  para uma pesquisa nova.
- Sem pesquisa salva, a seleção fica só na tela: o app avisa e pede confirmação antes de perder.
- A planilha é gerada de novo a cada exportação, com o nome da pesquisa no arquivo (`casa-adriana-2026-10-28.xlsx`).
- Os resultados são copiados pelo backend a partir da busca (`buscas`), por isso é preciso salvar até 6 h depois de pesquisar.
- A antiga marcação única por imóvel (`avaliacoes_imovel.incluido_avaliacao`) não é mais usada pela tela; fica no banco.

### Colunas da planilha

`Nº`, `Endereço com nº`, `Bairro`, `Área construída (m²)`, `Área do terreno (m²)`, `Preço total (R$)`, `Preço/m² (R$)`,
`Pavimentos`, `Condomínio`, `Dormitórios`, `Suítes`, `Banheiros`, `Vagas cobertas`, `Vagas descobertas`, `Vagas total`,
`Área de lazer / churrasqueira`, `Piscina`, `Padrão de acabamento (VEIU)`, `Idade`, `Estado IBAPE`, `Depreciação IBAPE (%)`,
`Data do evento`, `Informante`, `Contato`, `Fonte de pesquisa`,
`Link do anúncio`, `Observações`.

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

**Como ler a linha da triagem: "Precisa de revisão: 37% · Justificativa coerente: 84% · Nota de coerência: 3.5/5"?**
É a conferência do Jev (segunda camada) sobre a sugestão da IA das fotos. O Jev **não vê as fotos**: ele só lê o texto da
sugestão (classe, padrão, justificativa, confiança e quantas fotos foram lidas) e julga se ela faz sentido. Os três números são:
- **Precisa de revisão (37%):** a chance, segundo o Jev, de um humano precisar rever a sugestão antes de usá-la. Quanto menor, melhor.
  Acima de `JEV_LIMITE_REVISAO` (0,5) a revisão vira obrigatória.
- **Justificativa coerente (84%):** a chance de a justificativa descrever sinais compatíveis com a classe de conservação
  sugerida. Quanto maior, melhor. Abaixo de `JEV_LIMITE_COERENCIA` (0,5) a revisão vira obrigatória.
- **Nota de coerência (3.5/5):** a nota geral de consistência entre fotos lidas, justificativa e classe: 1 = incoerente,
  3 = razoável, 5 = excelente. Pode ter decimal porque é uma média ponderada. Abaixo de `JEV_NOTA_MINIMA` (3) a revisão vira obrigatória.

Exemplo: 37% / 84% / 3.5 está dentro dos três limites, então o quadro aparece verde ("Triagem sem ressalvas"). Se qualquer um
passar do limite, ou se o Jev ficar indisponível, o quadro fica vermelho ("Revisão humana obrigatória") com o motivo.
Se a confiança da IA for baixa ou o padrão vier vazio, aparece também a "Segunda opinião de padrão", com até 3 candidatos e a
chance de cada um; ela não altera a sugestão.
Atenção: "sem ressalvas" **não é aprovação** e não confirma que a classe está certa (o Jev nunca viu as fotos); só indica que
a sugestão é consistente em si. Nada vai para a avaliação sem o OK da avaliadora, e é ela quem decide.

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
- **Limites da triagem:** os valores padrão (0,5 / 0,5 / 3) são pontos de partida e precisam ser calibrados com casos reais.

### Testes

```bash
cd web
npm test        # análise de fotos, triagem do Jev e regras de gravação
npx tsc --noEmit && npx eslint src test
```

## Pontos em aberto que afetam o código

- **Lista de bairros** ([web/src/lib/bairros.ts](web/src/lib/bairros.ts)): é provisória e precisa ser substituída pela oficial.
- **Autenticação**: login por e-mail e senha (seção "Login"). Ainda não há cadastro pela tela nem tela de administração de usuários.
- **Hospedagem**: o front fica na Vercel; a coleta e o Postgres ficam na VPS (EasyPanel), ver [backend/README.md](backend/README.md).
- **Coluna "Idade"** da planilha: nenhuma fonte publica esse dado, então ela sai vazia na exportação.
