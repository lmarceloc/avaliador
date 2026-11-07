-- Correções à mão para casas: térrea/sobrado e geminada (null = vale o que o anúncio indica).
alter table avaliacoes_imovel add column if not exists tipo_casa text check (tipo_casa in ('terrea', 'sobrado'));
alter table avaliacoes_imovel add column if not exists geminada boolean;
