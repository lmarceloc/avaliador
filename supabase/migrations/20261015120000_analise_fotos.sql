-- Sugestão de avaliação por análise de fotos. A sugestão é rascunho: só vai para avaliacoes_imovel
-- quando o usuário confirma no front.

-- IBAPE-SP, Quadro 1: a classe I (sem valor / ruína) passa a ser aceita.
alter table public.avaliacoes_imovel drop constraint if exists avaliacoes_imovel_estado_conservacao_check;
alter table public.avaliacoes_imovel
  add constraint avaliacoes_imovel_estado_conservacao_check
  check (estado_conservacao in ('A','B','C','D','E','F','G','H','I'));

create table if not exists public.analises_foto (
  id             uuid primary key,
  imovel_id      text not null,
  status         text not null check (status in ('sugerido','erro')),
  ec_classe      text check (ec_classe in ('A','B','C','D','E','F','G','H','I')),
  padrao_codigo  text check (padrao_codigo in ('2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8')),
  padrao_sisdia  integer,        -- null enquanto o mapeamento do padrão estiver a confirmar
  justificativa  text,
  confianca      text check (confianca in ('baixa','media','alta')),
  modelo         text not null,
  resposta_bruta text,           -- só preenchido com LOG_RESPOSTA_BRUTA=true (depuração)
  criado_em      timestamptz not null default now(),
  aprovado_por   text,
  aprovado_em    timestamptz
);
create index if not exists analises_foto_imovel_idx on public.analises_foto (imovel_id, criado_em desc);

create table if not exists public.analises_foto_log (
  id             uuid primary key,
  analise_id     uuid not null references public.analises_foto (id) on delete cascade,
  imovel_id      text not null,
  foto_url       text not null,
  foto_sha256    text,
  bytes          integer,
  content_type   text,
  modelo         text not null,
  provedor       text not null,
  status         text not null check (status in ('lida','ignorada','erro')),
  motivo_erro    text,
  tokens_entrada integer,
  tokens_saida   integer,
  latencia_ms    integer,
  criado_em      timestamptz not null default now()
);
create index if not exists analises_foto_log_analise_idx on public.analises_foto_log (analise_id);

alter table public.analises_foto     enable row level security;
alter table public.analises_foto_log enable row level security;
