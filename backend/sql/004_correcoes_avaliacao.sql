-- Correções feitas à mão pela avaliadora quando o anúncio não traz o dado (null = vale o do anúncio).
alter table avaliacoes_imovel add column if not exists area_terreno_m2 numeric check (area_terreno_m2 > 0 and area_terreno_m2 < 10000000);
alter table avaliacoes_imovel add column if not exists piscina boolean;
alter table avaliacoes_imovel add column if not exists condominio boolean;
