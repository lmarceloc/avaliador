# Proposta: base própria de imóveis (robô noturno)

Status: **guardada para discutir depois** (conversa de 14/11/2026). Nada disto foi implementado.

Os números são **estimativas** feitas a partir do código (o ambiente da análise não tinha acesso aos sites das
imobiliárias). A Fase 0 abaixo troca as estimativas por números reais.

## Problema hoje

Cada busca vai aos sites das imobiliárias na hora. Por imobiliária: até 10 páginas de lista e até **50 anúncios
abertos em detalhe** (25 na Madol), com ~1 s entre acessos (`backend/src/conectores-base.js`, `CONFIG_PADRAO`).

- ~60 acessos por imobiliária por busca: ~700 numa busca em Ponta Grossa (12 imobiliárias), ~1.200 em Curitiba (21).
- 60–120 s de espera por busca.
- **Resultado incompleto**: se 200 casas atendem o filtro numa imobiliária, só 50 são abertas.
- O cache só ajuda com o filtro idêntico; mudou o preço máximo, vai aos sites de novo.
- Custo e risco de bloqueio crescem com o número de clientes (5 empresas × 10 buscas/dia ≈ 35–60 mil acessos/dia).

## A proposta

- Um robô percorre o estoque inteiro de cada imobiliária, por cidade, fora do horário de uso.
- Tabela `imoveis`: campos de busca em colunas (cidade, tipo, finalidade, bairro, preço, áreas, quartos…), o resto em
  JSON, mais `primeiro_visto`, `ultimo_visto` e `ativo`. Histórico de preço em tabela própria (uma linha por mudança).
- A busca vira uma consulta no banco. A coleta ao vivo continua para o "atualizar agora".

## Ganho para o usuário

- **Velocidade**: de 60–120 segundos para menos de 1 segundo.
- **Resultado completo**: todos os imóveis que atendem o filtro, sem o limite de 50 por imobiliária.
- **Filtros livres**: mudar preço, bairro ou área responde na hora, com ordenação e comparações (R$/m² por bairro,
  por exemplo).
- **Recursos que hoje não existem**, úteis para quem faz avaliação:
  - dias no mercado de cada imóvel;
  - histórico de preço ("baixou 8% em 30 dias");
  - imóveis que saíram do ar (indício de venda);
  - alertas de "imóvel novo que atende esta pesquisa".
- **Custo para o usuário**: os dados podem ter até ~24 horas. O "atualizar agora" continua disponível quando for
  preciso.

## Peso no banco (estimativa)

| Item | Estimativa |
|---|---|
| Estoque (venda + locação) | Ponta Grossa ~5–10 mil; Curitiba ~10–20 mil → ~15–30 mil imóveis |
| Tamanho por imóvel | ~3–6 KB (dados + **links** das fotos; as imagens continuam no site da imobiliária) |
| Total com índices | ~150–300 MB |
| Histórico de preços | poucos MB por mês |

Consulta em ~30 mil linhas com índice: menos de 50 ms. O cache atual pode pesar mais que isso, porque guarda a resposta
inteira de cada busca e repete os mesmos imóveis muitas vezes.

## Peso na VPS (estimativa)

- **Primeira carga**: abrir o detalhe de todo o estoque uma vez. Com as imobiliárias em paralelo, no ritmo de hoje:
  ~30–60 min (~1.000 anúncios por imobiliária). Pode ser dividida em duas madrugadas.
- **Rodada de atualização**: só o que mudou. ~10–20 min, pico de ~200–400 MB de RAM, CPU baixa.
- Custo fixo: 5 ou 50 empresas custam o mesmo para o robô.
- Falta confirmar a configuração da VPS (RAM, núcleos, disco livre).

## Frequência do robô

| | Todo dia | 2x por semana |
|---|---|---|
| Idade máxima do dado | ~24 h | ~3–4 dias |
| Duração de cada rodada | ~10–20 min | ~20–40 min |
| Acessos aos sites por semana | ~20–35 mil | ~10–15 mil |
| "Dias no mercado" e "saiu do ar" | precisão de 1 dia | precisão de 3–4 dias |
| Imóvel novo aparece na busca | no dia seguinte | até 4 dias depois |

**Sugestão (meio-termo):**
- **Lista todo dia** (~1.500 páginas, ~5–10 min): já mostra imóveis novos, os que saíram do ar e mudanças de preço.
- **Detalhes 2x por semana**: fotos, descrição e áreas dos imóveis novos (a parte cara).
- **"Atualizar agora"** na tela para quando uma avaliação não pode esperar.
- Frequência configurável por cidade e por imobiliária (ex.: menos frequente na Madol, que pede captcha).

## O que pesa no desenvolvimento

1. **Modo "coletar tudo" em cada conector**: hoje eles montam a URL com o filtro (tipo, bairro, preço) e priorizam os
   detalhes pelo filtro. São 33 conectores, mas vários de Curitiba compartilham plataforma, e os que leem sitemap já
   percorrem tudo.
2. **Detectar mudança** pela página de lista, para não reabrir todos os detalhes.
3. **Monitoramento**: avisar quando uma imobiliária voltar 0 imóveis ou cair pela metade de um dia para o outro.
4. **Ids estáveis dos imóveis** (análises e pesquisas salvas dependem deles; o formato atual, ex. `flow-2380797-001`,
   já serve).
5. **Jurídico**: uma cópia organizada dos anúncios deixa a "base de dados de terceiros" mais evidente. Guardar só
   dados + link, com fotos apontando para o site da imobiliária, ajuda; validar com advogado antes de vender como SaaS.

## Fases sugeridas

- **Fase 0 (medir)**: os logs do backend no EasyPanel já mostram, a cada busca, linhas como
  `flow: 312 imóveis em 16 páginas; abrindo 50 detalhes`. Um trecho de log de uma busca ampla + a configuração da VPS
  fecham os números.
- **Fase 1 (Ponta Grossa)**: tabela `imoveis`, robô nas 12 imobiliárias, busca lendo do banco. Se a base estiver velha
  ou uma imobiliária falhou na noite, a busca volta para a coleta ao vivo.
- **Fase 2**: Curitiba, histórico de preço e dias no mercado.
- **Fase 3**: alertas e mapa.
