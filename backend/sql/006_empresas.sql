-- Empresas: cada usuário pertence a uma empresa e só vê o que é dela (pesquisas salvas, análises da
-- avaliadora e análises de fotos). O cache de buscas continua compartilhado entre todas: o resultado da
-- coleta nas imobiliárias é público e igual para qualquer empresa, então uma busca com os mesmos filtros
-- feita por outra empresa responde na hora, sem ir de novo aos sites.
--
-- Tudo o que já existe vai para a empresa inicial "Agência Byte", e os usuários atuais viram admin dela.

create table if not exists empresas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(nome) between 1 and 120),
  ativa      boolean not null default true,   -- false = ninguém da empresa entra
  criado_em  timestamptz not null default now()
);
create unique index if not exists empresas_nome_idx on empresas (lower(nome));

insert into empresas (nome) values ('Agência Byte');

-- Usuários: empresa + papel (admin poderá, no futuro, cadastrar a própria equipe).
-- on delete restrict: uma empresa só pode ser apagada depois de remover os usuários dela.
alter table usuarios add column empresa_id uuid references empresas (id) on delete restrict;
alter table usuarios add column papel text not null default 'membro' check (papel in ('admin', 'membro'));
update usuarios set empresa_id = (select id from empresas), papel = 'admin';
alter table usuarios alter column empresa_id set not null;
create index if not exists usuarios_empresa_idx on usuarios (empresa_id);

-- Pesquisas salvas: o nome passa a ser único dentro da empresa (duas empresas podem ter "Casa Adriana").
alter table pesquisas_salvas add column empresa_id uuid references empresas (id) on delete cascade;
alter table pesquisas_salvas add column criado_por uuid references usuarios (id) on delete set null;
update pesquisas_salvas set empresa_id = (select id from empresas);
alter table pesquisas_salvas alter column empresa_id set not null;
drop index if exists pesquisas_salvas_nome_idx;
create unique index if not exists pesquisas_salvas_nome_idx on pesquisas_salvas (empresa_id, lower(nome));
create index if not exists pesquisas_salvas_empresa_idx on pesquisas_salvas (empresa_id, atualizado_em desc);
-- pesquisas_selecao não muda: herda a empresa pela pesquisa (pesquisa_id → pesquisas_salvas).

-- Análise da avaliadora: uma por imóvel POR EMPRESA (antes era uma só para todo mundo).
alter table avaliacoes_imovel add column empresa_id uuid references empresas (id) on delete cascade;
alter table avaliacoes_imovel add column atualizado_por uuid references usuarios (id) on delete set null;
update avaliacoes_imovel set empresa_id = (select id from empresas);
alter table avaliacoes_imovel alter column empresa_id set not null;
alter table avaliacoes_imovel drop constraint avaliacoes_imovel_pkey;
alter table avaliacoes_imovel add primary key (empresa_id, imovel_id);

-- Análises de fotos por IA: da empresa que pediu. analises_foto_log e triagens_jev herdam pela analise_id.
alter table analises_foto add column empresa_id uuid references empresas (id) on delete cascade;
alter table analises_foto add column usuario_id uuid references usuarios (id) on delete set null;
update analises_foto set empresa_id = (select id from empresas);
alter table analises_foto alter column empresa_id set not null;
drop index if exists analises_foto_imovel_idx;
create index if not exists analises_foto_imovel_idx on analises_foto (empresa_id, imovel_id, criado_em desc);

-- Buscas: o cache é compartilhado (a consulta pela chave_cache ignora a empresa). empresa_id e usuario_id
-- registram quem pediu cada busca, para uso e cobrança, e restringem a leitura de cada requisicao_id a
-- quem a fez.
alter table buscas add column empresa_id uuid references empresas (id) on delete cascade;
alter table buscas add column usuario_id uuid references usuarios (id) on delete set null;
update buscas set empresa_id = (select id from empresas);
alter table buscas alter column empresa_id set not null;
create index if not exists buscas_empresa_idx on buscas (empresa_id, criado_em desc);

-- Busca em andamento compartilhada: se outra empresa pede os mesmos filtros enquanto a coleta ainda roda,
-- a busca dela "segue" a que já está em andamento (origem_id) em vez de abrir os sites de novo.
-- A seguidora vence junto com a origem (mesmo expira_em), então apagar as duas juntas não perde nada.
alter table buscas add column origem_id uuid references buscas (requisicao_id) on delete cascade;
-- No máximo uma coleta em andamento por chave de cache: é o que garante a carona mesmo com dois pedidos
-- chegando ao mesmo tempo. Antes do índice, coletas repetidas que ficaram "processando" de uma subida
-- anterior (o serviço caiu no meio) viram erro, exceto a mais recente de cada chave.
update buscas b
   set status = 'erro', concluido_em = now(),
       resposta = jsonb_build_object(
         'requisicao_id', b.requisicao_id, 'status', 'erro', 'gerado_em', now(),
         'fontes', coalesce(b.fontes_status, '[]'::jsonb), 'imoveis', '[]'::jsonb,
         'erros', jsonb_build_array(jsonb_build_object('fonte', '*', 'codigo', 'INTERROMPIDA',
           'mensagem', 'A busca foi interrompida porque o serviço reiniciou. Faça a busca de novo.')))
 where b.status = 'processando'
   and exists (select 1 from buscas o
                where o.chave_cache = b.chave_cache and o.status = 'processando'
                  and (o.criado_em, o.requisicao_id) > (b.criado_em, b.requisicao_id));
create unique index if not exists buscas_em_andamento_idx on buscas (chave_cache)
  where status = 'processando' and origem_id is null;
