-- Pesquisas salvas: um conjunto de resultados com nome ("Casa Adriana") e a seleção da avaliadora para ele.
-- A seleção é por pesquisa; a análise do imóvel (avaliacoes_imovel) continua sendo uma só.
-- avaliacoes_imovel.incluido_avaliacao deixa de ser usada pelo site (fica no banco como histórico).
create table if not exists pesquisas_salvas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(nome) between 1 and 80),
  filtros        jsonb not null,
  fontes         jsonb not null,
  resposta       jsonb not null,   -- resultado completo (seção 5.2) no momento em que foi salvo
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  expira_em      timestamptz not null default now() + interval '30 days'   -- 30 dias depois da última alteração
);
create unique index if not exists pesquisas_salvas_nome_idx on pesquisas_salvas (lower(nome));
create index if not exists pesquisas_salvas_expira_idx on pesquisas_salvas (expira_em);

create table if not exists pesquisas_selecao (
  pesquisa_id    uuid not null references pesquisas_salvas (id) on delete cascade,
  imovel_id      text not null,
  incluido       boolean not null,  -- true = incluir na avaliação; false = excluído
  atualizado_em  timestamptz not null default now(),
  primary key (pesquisa_id, imovel_id)
);
