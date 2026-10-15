-- Busca de Imóveis – fase 1 (Ponta Grossa/PR)
-- Tabelas: fontes (cadastro dos conectores), buscas (cache + resultado dos jobs assíncronos)
-- e avaliacoes_imovel (análise manual da avaliadora, separada dos dados do anúncio).
-- Acesso apenas pelo servidor (front via rota de API e n8n), ambos com a service role.
-- RLS ligado e sem políticas para anon/authenticated: nada é exposto pela chave pública.

-- 6.2 Cadastro de fontes
create table if not exists public.fontes (
  id               text primary key,
  nome             text not null,
  cidade           text not null default 'Ponta Grossa',
  uf               char(2) not null default 'PR',
  tipo_coleta      text not null default 'http_html' check (tipo_coleta in ('http_html', 'renderizacao_js', 'api_oficial', 'a_levantar')),
  url_base         text,
  ativa            boolean not null default false,
  max_paginas      int not null default 10 check (max_paginas between 1 and 50),
  timeout_s        int not null default 25,
  intervalo_ms     int not null default 1500,
  media_itens      int,          -- usado no teste de sanidade (0 itens numa fonte que costuma ter → "possível mudança de layout")
  termos_verificados_em date,    -- seção 9: termos de uso e robots.txt conferidos antes de ativar
  observacao       text,
  criado_em        timestamptz not null default now()
);

insert into public.fontes (id, nome, tipo_coleta, ativa, observacao) values
  ('flow',         'Flow Imobiliária', 'http_html',  true,  null),
  ('kikina',       'Kikina Imóveis',   'http_html',  true,  null),
  ('adquira',      'Adquira Imóveis',  'http_html',  true,  null),
  ('torre_branca', 'Torre Branca',     'a_levantar', false, 'Fase 1 (a validar)'),
  ('quintoandar',  'QuintoAndar',      'a_levantar', false, 'Avaliar (focado em aluguel)')
on conflict (id) do nothing;

-- 4.5 Cache e 6.4 jobs assíncronos: uma linha por requisição.
-- chave_cache = hash de (fontes ordenadas + filtros normalizados), calculado no n8n.
create table if not exists public.buscas (
  requisicao_id  uuid primary key,
  chave_cache    text not null,
  status         text not null default 'processando' check (status in ('processando', 'concluido', 'parcial', 'erro')),
  requisicao     jsonb not null,
  resposta       jsonb,          -- corpo completo da resposta (seção 5.2)
  fontes_status  jsonb,          -- progresso por fonte enquanto processa
  criado_em      timestamptz not null default now(),
  concluido_em   timestamptz,
  expira_em      timestamptz not null default now() + interval '6 hours'
);

create index if not exists buscas_cache_idx on public.buscas (chave_cache, expira_em desc) where status in ('concluido', 'parcial');
create index if not exists buscas_expira_idx on public.buscas (expira_em);

-- Limpeza do TTL de 6 h. Agendar com pg_cron (ou um cron no n8n chamando esta função):
--   select cron.schedule('limpar-buscas', '15 * * * *', 'select public.limpar_buscas_expiradas()');
create or replace function public.limpar_buscas_expiradas() returns int
language sql security definer set search_path = public as $$
  with apagadas as (delete from public.buscas where expira_em < now() returning 1)
  select count(*)::int from apagadas;
$$;

-- 7. Análise da avaliadora
create table if not exists public.avaliacoes_imovel (
  imovel_id           text primary key,  -- mesmo id do contrato (ex.: flow-2380797-001)
  estado_conservacao  text check (estado_conservacao in ('A','B','C','D','E','F','G','H')),
  padrao_acabamento   text,
  observacoes         text,
  incluido_avaliacao  boolean,           -- null = não decidido; true = incluir; false = excluir
  atualizado_em       timestamptz not null default now()
);

create or replace function public.tocar_atualizado_em() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists avaliacoes_atualizado_em on public.avaliacoes_imovel;
create trigger avaliacoes_atualizado_em before update on public.avaliacoes_imovel
  for each row execute function public.tocar_atualizado_em();

alter table public.fontes            enable row level security;
alter table public.buscas            enable row level security;
alter table public.avaliacoes_imovel enable row level security;

revoke execute on function public.limpar_buscas_expiradas() from public, anon, authenticated;
