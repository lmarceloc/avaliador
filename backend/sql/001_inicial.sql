-- Banco do avaliador no Postgres da VPS (substitui o Supabase).
-- Mesmas tabelas e regras das antigas migrações do Supabase, sem RLS: só o backend acessa o banco,
-- pela rede interna do EasyPanel.

-- 4.5 Cache e 6.4 jobs assíncronos: uma linha por requisição.
-- chave_cache = hash de (cidade + fontes ordenadas + filtros normalizados), calculado em src/buscas.ts.
create table if not exists buscas (
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
create index if not exists buscas_cache_idx on buscas (chave_cache, expira_em desc) where status in ('concluido', 'parcial');
create index if not exists buscas_expira_idx on buscas (expira_em);

-- 7. Análise da avaliadora
create table if not exists avaliacoes_imovel (
  imovel_id           text primary key,  -- mesmo id do contrato (ex.: flow-2380797-001)
  estado_conservacao  text check (estado_conservacao in ('A','B','C','D','E','F','G','H','I')),
  padrao_acabamento   text,
  observacoes         text,
  incluido_avaliacao  boolean,           -- null = não decidido; true = incluir; false = excluir
  atualizado_em       timestamptz not null default now()
);

create or replace function tocar_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists avaliacoes_atualizado_em on avaliacoes_imovel;
create trigger avaliacoes_atualizado_em before update on avaliacoes_imovel
  for each row execute function tocar_atualizado_em();

-- Sugestão de avaliação por análise de fotos. A sugestão é rascunho: só vai para avaliacoes_imovel
-- quando o usuário confirma no front.
create table if not exists analises_foto (
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
create index if not exists analises_foto_imovel_idx on analises_foto (imovel_id, criado_em desc);

create table if not exists analises_foto_log (
  id             uuid primary key,
  analise_id     uuid not null references analises_foto (id) on delete cascade,
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
create index if not exists analises_foto_log_analise_idx on analises_foto_log (analise_id);

-- Triagem em texto com o Jev (TypeSafe) depois da análise de fotos: uma linha por pergunta.
-- É só recomendação; nada daqui grava em avaliacoes_imovel.
create table if not exists triagens_jev (
  id              uuid primary key,
  analise_id      uuid not null references analises_foto (id) on delete cascade,
  imovel_id       text not null,
  pergunta        text not null,
  tipo            text not null check (tipo in ('boolean','choice','score')),
  probabilidade   double precision,   -- boolean: P(sim); choice: P da opção escolhida
  valor_escolhido text,               -- choice: código do padrão
  nota            double precision,   -- score: 1 a 5
  modelo          text not null,
  status          text not null check (status in ('ok','erro')),
  motivo_erro     text,
  latencia_ms     integer,            -- da chamada (todas as perguntas vão numa só)
  resposta_bruta  jsonb,              -- só com LOG_RESPOSTA_BRUTA=true
  criado_em       timestamptz not null default now()
);
create index if not exists triagens_jev_analise_idx on triagens_jev (analise_id);
