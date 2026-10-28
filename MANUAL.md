# Manual de uso — Busca de Imóveis (Ponta Grossa/PR)

Este manual explica, para quem usa o sistema no dia a dia, como pesquisar imóveis, o que cada filtro faz, como funciona o botão de análise por IA e como levar os resultados para o Excel.

---

## 1. Visão geral do fluxo

1. Você escolhe os **filtros** e as **fontes** (imobiliárias) no painel da esquerda e clica em **Pesquisar**.
2. O sistema coleta os anúncios nos sites, junta os repetidos e confere cada imóvel contra os seus filtros.
3. Você abre os imóveis que interessam, vê fotos e dados, pede a **sugestão da IA** (opcional), preenche a **Análise da avaliadora** e marca **Incluir na avaliação**.
4. Você exporta para **Excel (XLSX)** ou **CSV**. Só saem os imóveis marcados como incluídos.

> Em telas pequenas (celular), o painel de filtros fica atrás do botão **Filtros** no topo.

---

## 2. Como fazer uma busca

1. **Tipo de imóvel** (obrigatório): marque Casa, Apartamento e/ou Terreno.
2. **Fontes** (obrigatório): marque ao menos uma imobiliária.
3. Preencha os demais filtros que quiser (todos são opcionais; campo vazio = sem restrição).
4. Clique em **Pesquisar**. Aparece o andamento por fonte (na fila → buscando → concluído ou falhou).
5. Quando termina, os imóveis aparecem em lista, com o resumo no topo (total, quantos atendem, repetidos agrupados).

**Botão Atualizar** (aparece depois da primeira busca): refaz a coleta direto nos sites, ignorando o cache. Sem ele, uma busca igual feita há menos de **6 horas** reaproveita o resultado guardado, que é mais rápido.

**Se uma fonte falhar**, aparece um aviso e os resultados mostrados vêm das demais. A fonte Madol pode pedir captcha e falhar com mais frequência.

---

## 3. O que cada filtro faz

| Filtro | O que faz | Observações |
|---|---|---|
| **Tipo de imóvel** | Mostra só os tipos marcados. | Obrigatório. |
| **Bairros** | Só imóveis dos bairros escolhidos. Digite para procurar, clique para marcar; os escolhidos viram etiquetas (clique para remover, ou em **limpar**). | Vazio = todos os bairros. Ignora acentos e maiúsculas. |
| **Área construída (m²)** | Mínimo e/ou máximo da área construída. | Não se aplica a terreno. |
| **Área do terreno (m²)** | Mínimo e/ou máximo da área do terreno. | Não se aplica a apartamento. |
| **Preço total (R$)** | Mínimo e/ou máximo do preço anunciado. | Os pontos de milhar entram sozinhos enquanto você digita (`1800000` vira `1.800.000`). Use a vírgula para centavos; ao sair do campo ele completa o formato, como `1.800.000,00`. |
| **Dormitórios / Suítes / Banheiros / Vagas** | Quantidade **mínima**: "2" aceita 2 ou mais. | Vagas considera o total (cobertas + descobertas). Não se aplica a terreno. |
| **Pavimentos** | Mínimo e/ou máximo de andares. | Não se aplica a terreno. |
| **Condomínio** | **Sim** = só em condomínio; **Não** = só fora de condomínio; **Indiferente** = sem restrição. | |
| **Fontes** | Quais imobiliárias serão consultadas. | Obrigatório. Fontes disponíveis: Flow, Kikina, Adquira, Conceito, Casa Top, Clássica, Madol, Tavarnaro, Aspen e Torre Blanca. |

### O que acontece quando o anúncio não informa um dado

Se o anúncio não traz o dado que o filtro pede (por exemplo, não informa a suíte), o critério fica como **não verificado**. O imóvel **não é descartado** por isso: ele aparece com a indicação do que faltou, para você decidir. Em cada imóvel, a lista de critérios mostra:

- ✔ **atende** — o dado existe e está dentro do filtro;
- ✘ **não atende** — o dado existe e está fora do filtro;
- ? **não verificado** — o anúncio não informa.

"Atende todos os filtros" só vale quando **todos** os critérios foram verificados e atendidos.

---

## 4. Trabalhando com os resultados

### Filtros rápidos (acima da lista)
Refinam o que já foi coletado, **sem nova busca**: tipo, bairro, fonte, status, preço mínimo/máximo e a opção **Mostrar fora do filtro**.

Por padrão, imóveis que **não atendem** algum critério ficam escondidos; marque *Mostrar fora do filtro* para vê-los (o número entre parênteses diz quantos estão ocultos).

**Status:**
- **Atende todos** / **Não atende**: resultado da conferência contra os filtros.
- **Repetido**: o mesmo imóvel apareceu em mais de uma imobiliária. O sistema mantém **um** card (o com mais dados e fotos) e guarda os outros links como "fontes alternativas". Duas ofertas são consideradas o mesmo imóvel quando têm o mesmo código da imobiliária ou, na falta dele, mesmo logradouro e número, área construída e preço com diferença de até 1%.
- **Outlier**: preço por m² muito fora do padrão do conjunto — mais de 1,5 desvio-padrão da mediana. Só é calculado quando há pelo menos 4 imóveis com preço/m². É um alerta para conferir o anúncio, não uma exclusão.

### Ordenação
Padrão: imóveis que atendem primeiro, depois menor preço/m². Também dá para ordenar por preço, área, preço/m² e data do anúncio (crescente ou decrescente). Imóveis sem o dado vão sempre para o fim.

### Detalhe do imóvel
Clique num card para abrir a ficha: galeria de fotos, dados do anúncio, critérios, fontes alternativas, link do anúncio original, a **Avaliação da IA** e a **Análise da avaliadora**. As setas ← → navegam entre os imóveis da lista.

---

## 5. Botão de análise por IA ("Sugerir avaliação")

Fica na ficha do imóvel, no bloco **Avaliação da IA (fotos)**. Ele olha as fotos do anúncio e **sugere** duas classificações. É uma ajuda para a avaliadora — **a decisão é sempre sua**.

### Como usar
1. Abra o imóvel e clique em **Sugerir avaliação** (desabilitado se o imóvel não tem fotos).
2. Aguarde: aparece "Lendo X de Y fotos…" e depois "Conferindo a coerência da sugestão (Jev)…". Pode levar até cerca de um minuto; mantenha a janela aberta.
3. Leia o resultado e a **triagem** (caixa colorida no topo).
4. Se concordar, clique em **OK — usar na análise da avaliadora**. Isso copia o estado de conservação e o padrão para a sua análise e salva.
5. Se discordar, ignore o OK e preencha seus próprios valores em **Análise da avaliadora**, depois **Salvar análise**.

> **Nada vai para a avaliação nem para a planilha sem o seu OK.** A sugestão da IA não é gravada sozinha.

### O que a IA avalia
Só as **fotos**. O limite por análise é configurável (`FOTOS_MAX`; o padrão do código é 6 e o `.env.example` usa 10). Não é sorteio: o sistema usa sempre a **primeira foto** (a capa, que costuma ser a fachada) e distribui as demais em intervalos iguais pela galeria, incluindo a **última**. O nome do cômodo não vem na URL da foto, então a escolha é por posição, e não dá para garantir que todos os ambientes entrem. Mais fotos deixam a análise mais lenta. Ela devolve:

**a) Estado de conservação — IBAPE-SP, Quadro 1 (classes A a I)**

| Classe | Estado | Depreciação |
|---|---|---|
| A | Nova | 0,00% |
| B | Entre nova e regular | 0,32% |
| C | Regular | 2,52% |
| D | Entre regular e necessitando de reparos simples | 8,09% |
| E | Necessitando de reparos simples | 18,10% |
| F | Necessitando de reparos simples a importantes | 33,20% |
| G | Necessitando de reparos importantes | 52,60% |
| H | Necessitando de reparos importantes a edificação sem valor | 75,20% |
| I | Sem valor (ruína) | 100,00% |

Critério usado pela IA ao olhar as fotos:
- **A**: sem sinais de desgaste; recém-construída ou reformada por completo.
- **B / C**: só pintura e desgaste leve de uso.
- **D / E**: precisa de reparos simples (pintura geral, pequenos reparos em revestimentos, esquadrias e instalações).
- **F / G**: reparos importantes (infiltrações, trincas, telhado, instalações e revestimentos comprometidos).
- **H**: reparos muito importantes, próximo de edificação sem valor.
- **I**: ruína.

**b) Padrão de acabamento — VEIU (2.1 a 2.8)**

| Código | Padrão | O que a IA procura nas fotos |
|---|---|---|
| 2.1 / 2.2 | Rústico / Proletário | Materiais rudimentares ou mínimos, sem revestimentos, cimento queimado, esquadrias simples |
| 2.3 / 2.4 | Econômico / Simples | Cerâmica comum, pintura látex, louças e metais básicos |
| 2.5 | Médio | Porcelanato ou cerâmica de boa qualidade, forro de gesso, box e bancadas em granito, caixilhos de alumínio |
| 2.6 / 2.7 | Superior / Fino | Porcelanato grande formato, mármore ou granito nobre, marcenaria planejada, automação, esquadrias de qualidade |
| 2.8 | Luxo | Materiais importados ou exclusivos, projeto arquitetônico de alto padrão |

**c) Também mostra:** o valor **Sisdia** correspondente ao padrão, a **confiança** (baixa / média / alta), uma **justificativa** em uma frase e quantas fotos foram efetivamente lidas.

> **Sisdia:** só estão confirmados 2.3 = 0, 2.4 = 2, 2.5 = 3 e 2.7 = 4. Para 2.1, 2.2, 2.6 e 2.8 o sistema mostra **"a confirmar"** — preencha manualmente.

**Atenção ao número de fotos:** nas fontes em que a coleta traz só os dados do card (imóveis além do limite de detalhes por busca), o imóvel vem apenas com a foto de capa e a ficha avisa que o detalhe não foi coletado. Nesse caso a IA lê 1 foto e a sugestão tende a vir com confiança baixa ou revisão obrigatória. Confira a quantidade em "Fotos lidas".

Se a IA não conseguir julgar pelas fotos (poucas, escuras, só externas), ela deixa o campo vazio e explica na justificativa. Fotos que não puderam ser lidas (link quebrado, arquivo acima de 20 MB, formato diferente de JPEG/PNG/WebP/GIF, endereço não público, demora de mais de 15 s no download) são ignoradas, o motivo fica registrado e a análise segue com as demais. Aparecem listadas no rodapé do bloco.

### A triagem (segunda camada de conferência)
Depois da leitura das fotos, um segundo modelo de texto (**Jev**) confere a sugestão **sem ver as imagens** — ele analisa só o resultado (classe, padrão, confiança, justificativa, nº de fotos lidas). Ele não recebe contato, preço, endereço nem link de foto. Ele responde a três perguntas:

1. **A sugestão precisa de revisão humana?** (considera poucas fotos, confiança baixa, campos ausentes, justificativa vaga ou contraditória)
2. **A justificativa é coerente com a classe sugerida?**
3. **Nota de coerência de 1 a 5** entre nº de fotos lidas, justificativa e classe (1 = incoerente, 3 = razoável, 5 = excelente). Pode ter decimal, como 3,5.

Na tela, a linha aparece assim: *"Precisa de revisão: 37% · Justificativa coerente: 84% · Nota de coerência: 3.5/5"*. Quanto **menor** o primeiro número, melhor; quanto **maior** o segundo e o terceiro, melhor. Esse exemplo está dentro dos três limites, então sai verde.

A caixa mostra **"Revisão humana obrigatória"** (vermelha) quando qualquer um destes ocorre:

| Condição | Limite padrão |
|---|---|
| Probabilidade de "precisa de revisão" acima do limite | 50% |
| Probabilidade de "justificativa coerente" abaixo do limite | 50% |
| Nota de coerência abaixo do mínimo | 3 de 5 |

Se nenhuma ocorrer, mostra **"Triagem sem ressalvas"** (verde). Se o Jev estiver indisponível, o resultado vem **sempre como revisão obrigatória** — falta de resposta nunca é tratada como aprovação.

Quando a confiança é baixa ou nenhum padrão foi identificado, a triagem também apresenta uma **segunda opinião de padrão** (até 3 candidatos, com a probabilidade de cada um). Ela é só informativa e não altera a sugestão.

### Como usar bem
- "Triagem sem ressalvas" **não é aprovação**: o Jev nunca viu as fotos, só confere se a sugestão é consistente em si. Trate como "nenhum alarme", não como garantia. Fotos de anúncio escolhem o melhor ângulo; confira o ambiente que a foto não mostra.
- Com **confiança baixa**, **poucas fotos lidas** ou **revisão obrigatória**, olhe as fotos você mesma antes de aceitar.
- A IA não enxerga idade real, estrutura, telhado por dentro nem instalações; o **Estado IBAPE** da planilha é uma classificação visual.
- Cada análise fica registrada (fotos lidas, modelo usado, quem aprovou e quando) para auditoria.

---

## 6. Análise da avaliadora e "Incluir na avaliação"

Na ficha do imóvel, o bloco **Análise da avaliadora** guarda o que vale para a planilha:

- **Estado de conservação** (A–I) e **Padrão de acabamento** (2.1–2.8);
- **Observações** (texto livre);
- **Salvar análise**: grava os campos acima;
- **Incluir na avaliação** (✔ Incluído): marca o imóvel para sair na exportação. Clicar de novo desmarca. Há também o botão de **excluir da avaliação**, que registra que o imóvel foi descartado.

O campo "Padrão de acabamento" é **um só**: o que a IA sugere e o que você preenche gravam no mesmo lugar (por exemplo, "2.5 Médio"). A IA só sugere; vale e vai para a planilha o que está salvo em "Análise da avaliadora". Se você não preencheu estado/padrão, a planilha usa o que o próprio anúncio informou (quando houver).

---

## 7. Como exportar para o Excel

1. Abra os imóveis que interessam e clique em **Incluir na avaliação** em cada um. (Dica: use as setas ← → na ficha para percorrer a lista.)
2. Na barra acima da lista aparece **"Exportar N incluídos"**. Se nenhum estiver marcado, os botões ficam desabilitados com a mensagem *"Marque 'Incluir na avaliação' para exportar"*.
3. Clique em **XLSX** (Excel) ou **CSV**.
4. O arquivo baixa como `pesquisa-imoveis-AAAA-MM-DD.xlsx` (ou `.csv`), com uma aba chamada **Pesquisa**.

**Pontos de atenção**
- Saem **apenas** os imóveis marcados como incluídos — inclusive os que estão escondidos pelos filtros rápidos da tela (o aviso "N ocultos pelos filtros da tela" lembra disso).
- O **CSV** usa ponto e vírgula como separador e vem pronto para abrir direto no Excel em português (acentos e vírgula decimal corretos). Se preferir, use o XLSX.

**Colunas da planilha (na ordem)**

| # | Coluna | De onde vem |
|---|---|---|
| 1 | Nº | Sequência da exportação |
| 2 | Endereço com nº | Anúncio (vazio se a imobiliária não divulga o logradouro) |
| 3 | Bairro | Anúncio, padronizado |
| 4 | Área construída (m²) | Anúncio |
| 5 | Área do terreno (m²) | Anúncio; se o campo não vier preenchido, lido do texto ("terreno de 462 m²", "terreno medindo 14x33") |
| 6 | Preço total (R$) | Anúncio |
| 7 | Preço/m² (R$) | Calculado: preço ÷ área construída |
| 8 | Pavimentos | Anúncio |
| 9 | Condomínio | Sim / Não |
| 10 | Dormitórios | Anúncio |
| 11 | Suítes | Anúncio |
| 12 | Banheiros | Anúncio |
| 13 | Vagas cobertas | Anúncio |
| 14 | Vagas descobertas | Anúncio |
| 15 | Vagas total | Anúncio |
| 16 | Área de lazer / churrasqueira | Sim / Não, lido da descrição e das características do anúncio (churrasqueira, espaço gourmet, salão de festas, piscina…) |
| 17 | Piscina | Sim / Não, lido da descrição e das características do anúncio. Conta também a piscina do condomínio. "Espaço/possibilidade para piscina" não conta |
| 18 | Padrão de acabamento (VEIU) | Sua análise (ou o anúncio, se vazia) |
| 19 | Idade | **Fica em branco** — as fontes não publicam; preencha na planilha |
| 20 | Estado IBAPE | Sua análise (ou o anúncio, se vazia): classe A a I |
| 21 | Depreciação IBAPE (%) | Percentual da classe no Quadro 1 (A = 0,00; B = 0,32; C = 2,52…); vazia se não há classe |
| 22 | Data do evento | Data em que o anúncio foi publicado no site da imobiliária (dd/mm/aaaa); vazia se a fonte não informa |
| 23 | Informante | Nome de quem passou a informação (corretor ou atendente do anúncio), quando o site mostra; algumas fontes só mostram o telefone da imobiliária e o campo sai vazio, e você pode preencher à mão |
| 24 | Contato | Telefone/contato do anúncio |
| 25 | Fonte de pesquisa | Nome da imobiliária |
| 26 | Link do anúncio | URL original |
| 27 | Observações | Sua análise (texto livre da ficha); vazia se não preencheu |

Dados que o anúncio não informa saem como **célula vazia** (nunca zero).

---

## 8. Dúvidas frequentes

**Uma imobiliária aparece como "falhou".** O site pode ter ficado fora do ar ou pedido captcha. Clique em **Atualizar** mais tarde; os resultados das outras fontes continuam válidos.

**Um imóvel que eu esperava não aparece.** Ele pode estar escondido por não atender a um critério: marque **Mostrar fora do filtro**. Também pode ter sido agrupado como repetido — veja as fontes alternativas no card.

**O botão de IA está desabilitado.** O imóvel não tem fotos coletadas, ou já há uma análise em andamento.

**A IA deu erro de configuração.** O servidor precisa das chaves da IA configuradas (`OPENROUTER_API_KEY` e `OPENROUTER_MODEL`; e `TYPESAFE_API_KEY` para a triagem). Avise quem administra o sistema. Sem a chave do Jev, a análise de fotos funciona, mas toda sugestão vem marcada como revisão obrigatória.

**Por que a tela mostra menos "Incluídos" do que o resumo do topo?** O resumo conta todos os incluídos da busca, mesmo os escondidos pelos filtros rápidos (ex.: "3 incluídos (2 ocultos pelos filtros da tela)"). Eles continuam indo para a planilha. Para vê-los, ligue "Mostrar fora do filtro"; para tirá-los da planilha, desmarque "Incluir na avaliação" em cada um.

**A busca demora?** Uma busca com várias fontes leva em torno de 1 minuto (nos testes, 9 fontes em paralelo levaram cerca de 72 s), porque o sistema abre a página de cada anúncio para pegar a galeria completa. O andamento aparece por fonte.

**"ignoradas: 1 — HTTP 403 no download" na análise de fotos.** O servidor da foto recusou o acesso, em geral porque a imobiliária bloqueia quem não vem do site dela. A foto é descartada e a análise segue com as demais.

**Os números do Excel vieram como texto.** Use o **XLSX**; no CSV o Excel precisa estar com configuração regional em português do Brasil.

---

## 9. Particularidades das fontes

- **Madol:** tem proteção com captcha. A coleta vai em ritmo lento e lê no máximo 25 anúncios por busca; se bloquear, a fonte volta como "verificação humana" e as outras seguem. Fotos "exclusivas" (atrás de cadastro) não são coletadas.
- **Tavarnaro:** não publica o logradouro, então a coluna "Endereço com nº" sai vazia.
- **Clássica:** muitos anúncios não publicam a área construída; esses imóveis ficam "não verificados" no filtro de área e sem preço/m².
- **Todas:** imóveis além do limite de detalhes por busca (50 por fonte, por padrão) vêm só com a foto de capa e a ficha avisa. Os detalhes abertos primeiro são os dos imóveis que não reprovam em nenhum critério.

---

## 10. Pontos ainda em aberto

- A **lista de bairros** é provisória e precisa ser trocada pela oficial; um bairro que não esteja na lista não pode ser escolhido no filtro.
- Os **valores Sisdia** de 2.1, 2.2, 2.6 e 2.8 dependem de confirmação (o valor 1 da escala também não tem padrão associado).
- Os **limites da triagem** (0,5 / 0,5 / 3) são pontos de partida e devem ser calibrados com casos reais.
- Os **termos de uso** de cada site de imobiliária ainda precisam ser conferidos antes de produção.

---

## 11. Para quem administra (referência rápida)

| Variável | Para que serve | Padrão |
|---|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Modelo de visão que lê as fotos | — |
| `FOTOS_MAX` | Máximo de fotos por análise | 6 |
| `TYPESAFE_API_KEY`, `JEV_MODEL` | Triagem com o Jev | `jev-1.13.0` |
| `JEV_LIMITE_REVISAO` | Acima disso → revisão obrigatória | 0,5 |
| `JEV_LIMITE_COERENCIA` | Abaixo disso → revisão obrigatória | 0,5 |
| `JEV_NOTA_MINIMA` | Nota (1–5) mínima de coerência | 3 |
| `JEV_TIMEOUT_MS` | Tempo máximo por tentativa do Jev | 20000 |
| `JEV_BASE_URL` | Gateway opcional do Jev | padrão do SDK |
| `LOG_RESPOSTA_BRUTA` | `true` grava a resposta bruta dos modelos (só depuração) | `false` |
| `APP_USUARIO`, `APP_SENHA` | Se definidos, o site pede login e senha (Basic Auth) | — |
| `BACKEND_URL`, `BACKEND_API_KEY` | Endereço e chave do backend da VPS (busca e banco) | — |

Mais detalhes em `web/.env.example` e `backend/README.md`.
