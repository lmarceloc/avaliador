-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.fontes (
  id text NOT NULL,
  nome text NOT NULL,
  cidade text NOT NULL DEFAULT 'Ponta Grossa'::text,
  uf character NOT NULL DEFAULT 'PR'::bpchar,
  tipo_coleta text NOT NULL DEFAULT 'http_html'::text CHECK (tipo_coleta = ANY (ARRAY['http_html'::text, 'renderizacao_js'::text, 'api_oficial'::text, 'a_levantar'::text])),
  url_base text,
  ativa boolean NOT NULL DEFAULT false,
  max_paginas integer NOT NULL DEFAULT 10 CHECK (max_paginas >= 1 AND max_paginas <= 50),
  timeout_s integer NOT NULL DEFAULT 25,
  intervalo_ms integer NOT NULL DEFAULT 1500,
  media_itens integer,
  termos_verificados_em date,
  observacao text,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fontes_pkey PRIMARY KEY (id)
);
CREATE TABLE public.buscas (
  requisicao_id uuid NOT NULL,
  chave_cache text NOT NULL,
  status text NOT NULL DEFAULT 'processando'::text CHECK (status = ANY (ARRAY['processando'::text, 'concluido'::text, 'parcial'::text, 'erro'::text])),
  requisicao jsonb NOT NULL,
  resposta jsonb,
  fontes_status jsonb,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  concluido_em timestamp with time zone,
  expira_em timestamp with time zone NOT NULL DEFAULT (now() + '06:00:00'::interval),
  CONSTRAINT buscas_pkey PRIMARY KEY (requisicao_id)
);
CREATE TABLE public.avaliacoes_imovel (
  imovel_id text NOT NULL,
  estado_conservacao text CHECK (estado_conservacao = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text, 'G'::text, 'H'::text, 'I'::text])),
  padrao_acabamento text,
  observacoes text,
  incluido_avaliacao boolean,
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT avaliacoes_imovel_pkey PRIMARY KEY (imovel_id)
);
CREATE TABLE public.analises_foto (
  id uuid NOT NULL,
  imovel_id text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['sugerido'::text, 'erro'::text])),
  ec_classe text CHECK (ec_classe = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text, 'G'::text, 'H'::text, 'I'::text])),
  padrao_codigo text CHECK (padrao_codigo = ANY (ARRAY['2.1'::text, '2.2'::text, '2.3'::text, '2.4'::text, '2.5'::text, '2.6'::text, '2.7'::text, '2.8'::text])),
  padrao_sisdia integer,
  justificativa text,
  confianca text CHECK (confianca = ANY (ARRAY['baixa'::text, 'media'::text, 'alta'::text])),
  modelo text NOT NULL,
  resposta_bruta text,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  aprovado_por text,
  aprovado_em timestamp with time zone,
  CONSTRAINT analises_foto_pkey PRIMARY KEY (id)
);
CREATE TABLE public.analises_foto_log (
  id uuid NOT NULL,
  analise_id uuid NOT NULL,
  imovel_id text NOT NULL,
  foto_url text NOT NULL,
  foto_sha256 text,
  bytes integer,
  content_type text,
  modelo text NOT NULL,
  provedor text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['lida'::text, 'ignorada'::text, 'erro'::text])),
  motivo_erro text,
  tokens_entrada integer,
  tokens_saida integer,
  latencia_ms integer,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analises_foto_log_pkey PRIMARY KEY (id),
  CONSTRAINT analises_foto_log_analise_id_fkey FOREIGN KEY (analise_id) REFERENCES public.analises_foto(id)
);
CREATE TABLE public.triagens_jev (
  id uuid NOT NULL,
  analise_id uuid NOT NULL,
  imovel_id text NOT NULL,
  pergunta text NOT NULL,
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['boolean'::text, 'choice'::text, 'score'::text])),
  probabilidade double precision,
  valor_escolhido text,
  nota double precision,
  modelo text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['ok'::text, 'erro'::text])),
  motivo_erro text,
  latencia_ms integer,
  resposta_bruta jsonb,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT triagens_jev_pkey PRIMARY KEY (id),
  CONSTRAINT triagens_jev_analise_id_fkey FOREIGN KEY (analise_id) REFERENCES public.analises_foto(id)
);