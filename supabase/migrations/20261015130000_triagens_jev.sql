-- Triagem em texto com o Jev (TypeSafe) depois da análise de fotos: uma linha por pergunta.
-- É só recomendação; nada daqui grava em avaliacoes_imovel.
create table if not exists public.triagens_jev (
  id              uuid primary key,
  analise_id      uuid not null references public.analises_foto (id) on delete cascade,
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
create index if not exists triagens_jev_analise_idx on public.triagens_jev (analise_id);

alter table public.triagens_jev enable row level security;
