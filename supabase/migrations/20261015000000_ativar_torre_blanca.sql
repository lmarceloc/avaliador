-- Ativação da imobiliária Torre Blanca após levantamento técnico e implementação do conector
update public.fontes
set
  nome = 'Torre Blanca',
  tipo_coleta = 'api_oficial',
  ativa = true,
  termos_verificados_em = current_date,
  observacao = 'Next.js SSR com API JSON nativa /_next/data/'
where id = 'torre_branca';
