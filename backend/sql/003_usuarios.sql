-- Usuários do site (login próprio por e-mail e senha, no lugar da senha única APP_USUARIO/APP_SENHA).
-- A senha nunca é guardada: só o hash scrypt (src/usuarios.ts). Hoje o cadastro é pelo console
-- (node dist/usuarios.mjs); um cadastro pela tela pode criar contas com ativo = false até alguém aprovar.
create table if not exists usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nome          text not null check (length(nome) between 1 and 80),
  senha_hash    text not null,
  ativo         boolean not null default true,   -- false = desativado ou aguardando aprovação
  criado_em     timestamptz not null default now(),
  ultimo_login  timestamptz
);
create unique index if not exists usuarios_email_idx on usuarios (email);
