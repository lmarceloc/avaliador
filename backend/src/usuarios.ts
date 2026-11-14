// Usuários do site: hash de senha (scrypt), login com bloqueio por tentativas e cadastro pelo console.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { Db } from "./db";

const scrypt = (senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions) =>
  new Promise<Buffer>((ok, falha) => scryptCb(senha, sal, tamanho, opcoes, (e, chave) => (e ? falha(e) : ok(chave))));

export class ErroUsuario extends Error {
  constructor(readonly codigo: number, mensagem: string) {
    super(mensagem);
  }
}

export type Papel = "admin" | "membro";

export interface Usuario {
  id: string;
  email: string;
  nome: string;
  papel: Papel;
  empresa: { id: string; nome: string };
}

/** Quem está fazendo a requisição: vem do usuário da sessão, conferido no banco a cada chamada. */
export interface Contexto {
  usuarioId: string;
  empresaId: string;
  papel: Papel;
}

const PARAMS = { N: 16384, r: 8, p: 1 };
const TAMANHO = 64;
export const SENHA_MIN = 8;
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CREDENCIAIS_INVALIDAS = "E-mail ou senha inválidos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Usuário com a empresa dele; só entra quem está ativo numa empresa ativa.
const SELECT_USUARIO = `select u.id, u.email, u.nome, u.papel, u.senha_hash, e.id as empresa_id, e.nome as empresa_nome
  from usuarios u join empresas e on e.id = u.empresa_id
 where u.ativo and e.ativa`;
type LinhaUsuario = { id: string; email: string; nome: string; papel: Papel; senha_hash: string; empresa_id: string; empresa_nome: string };
const paraUsuario = (l: LinhaUsuario): Usuario => ({
  id: l.id, email: l.email, nome: l.nome, papel: l.papel, empresa: { id: l.empresa_id, nome: l.empresa_nome },
});

/**
 * Contexto da requisição a partir do id do usuário logado. Consulta o banco toda vez: usuário ou empresa
 * desativados perdem o acesso na hora, mesmo com a sessão do site ainda válida.
 */
export async function contextoDoUsuario(db: Db, usuarioId: unknown): Promise<Contexto | null> {
  if (typeof usuarioId !== "string" || !UUID.test(usuarioId)) return null;
  const { rows } = await db.query<{ empresa_id: string; papel: Papel }>(
    "select u.empresa_id, u.papel from usuarios u join empresas e on e.id = u.empresa_id where u.id = $1 and u.ativo and e.ativa",
    [usuarioId],
  );
  return rows[0] ? { usuarioId, empresaId: rows[0].empresa_id, papel: rows[0].papel } : null;
}

/** "scrypt$N$r$p$sal$hash", tudo em base64url. */
export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, TAMANHO, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, sal.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, N, r, p, sal, hash] = guardado.split("$");
  if (alg !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64url");
  const calculado = await scrypt(senha, Buffer.from(sal, "base64url"), esperado.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(calculado, esperado);
}

// Hash de uma senha qualquer, para que usuário inexistente leve o mesmo tempo que senha errada.
const hashFalso = gerarHash(randomBytes(16).toString("hex"));

// Bloqueio simples em memória (um só processo): 5 erros seguidos travam o usuário por 15 minutos.
const MAX_ERROS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const erros = new Map<string, { n: number; ate: number }>();

export function normalizarEmail(e: unknown): string | null {
  if (typeof e !== "string") return null;
  const n = e.trim().toLowerCase();
  return n.length <= 254 && EMAIL_OK.test(n) ? n : null;
}

/** Confere e-mail e senha. Devolve o usuário ou lança 401 (credenciais) / 429 (bloqueado). */
export async function autenticar(db: Db, emailBruto: unknown, senha: unknown, agora = Date.now()): Promise<Usuario> {
  const email = normalizarEmail(emailBruto);
  if (!email || typeof senha !== "string" || !senha) throw new ErroUsuario(401, CREDENCIAIS_INVALIDAS);
  const registro = erros.get(email);
  if (registro && registro.ate > agora) throw new ErroUsuario(429, "Muitas tentativas erradas. Tente de novo em 15 minutos.");

  const { rows } = await db.query<LinhaUsuario>(`${SELECT_USUARIO} and u.email = $1`, [email]);
  const ok = await conferirSenha(senha, rows[0]?.senha_hash ?? (await hashFalso));
  if (!rows[0] || !ok) {
    const bloqueioVencido = registro !== undefined && registro.ate !== 0;
    const n = (bloqueioVencido ? 0 : registro?.n ?? 0) + 1;
    erros.set(email, { n, ate: n >= MAX_ERROS ? agora + BLOQUEIO_MS : 0 });
    throw new ErroUsuario(401, CREDENCIAIS_INVALIDAS);
  }
  erros.delete(email);
  await db.query("update usuarios set ultimo_login = now() where id = $1", [rows[0].id]);
  return paraUsuario(rows[0]);
}

export async function trocarSenha(db: Db, email: unknown, atual: unknown, nova: unknown): Promise<void> {
  if (typeof nova !== "string" || nova.length < SENHA_MIN) throw new ErroUsuario(400, `A senha nova precisa ter pelo menos ${SENHA_MIN} caracteres`);
  const u = await autenticar(db, email, atual);
  await db.query("update usuarios set senha_hash = $2 where id = $1", [u.id, await gerarHash(nova)]);
}

// ---------- Cadastro (console do backend) ----------

export interface Empresa {
  id: string;
  nome: string;
  ativa: boolean;
  usuarios: number;
}

export async function criarEmpresa(db: Db, nome: string): Promise<Empresa> {
  const n = nome.trim().replace(/\s+/g, " ");
  if (!n || n.length > 120) throw new ErroUsuario(400, "Informe o nome da empresa (até 120 caracteres)");
  try {
    const { rows } = await db.query<Empresa>("insert into empresas (nome) values ($1) returning id, nome, ativa, 0 as usuarios", [n]);
    return rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ErroUsuario(409, `Já existe uma empresa chamada ${n}`);
    throw e;
  }
}

export async function listarEmpresas(db: Db): Promise<Empresa[]> {
  const { rows } = await db.query<Empresa>(
    "select e.id, e.nome, e.ativa, (select count(*)::int from usuarios u where u.empresa_id = e.id) as usuarios from empresas e order by e.nome",
  );
  return rows;
}

/** Acha a empresa pelo nome (sem diferenciar maiúsculas). Sem nome, só funciona se houver uma única empresa. */
export async function acharEmpresa(db: Db, nome?: string): Promise<Empresa> {
  const todas = await listarEmpresas(db);
  if (!nome) {
    if (todas.length === 1) return todas[0];
    throw new ErroUsuario(400, `Há ${todas.length} empresas; informe qual com --empresa "<Nome>". Empresas: ${todas.map((e) => e.nome).join(", ") || "nenhuma"}`);
  }
  const achada = todas.find((e) => e.nome.toLowerCase() === nome.trim().toLowerCase());
  if (!achada) throw new ErroUsuario(404, `Empresa ${nome} não encontrada. Empresas: ${todas.map((e) => e.nome).join(", ") || "nenhuma"}`);
  return achada;
}

export async function definirEmpresaAtiva(db: Db, nome: string, ativa: boolean): Promise<void> {
  const e = await acharEmpresa(db, nome);
  await db.query("update empresas set ativa = $2 where id = $1", [e.id, ativa]);
}

export async function criarUsuario(
  db: Db, emailBruto: string, nome: string, senha: string, empresaId: string, papel: Papel = "membro",
): Promise<{ id: string; email: string; nome: string; papel: Papel }> {
  const email = normalizarEmail(emailBruto);
  if (!email) throw new ErroUsuario(400, "E-mail inválido");
  if (!nome.trim()) throw new ErroUsuario(400, "Informe o nome");
  if (senha.length < SENHA_MIN) throw new ErroUsuario(400, `A senha precisa ter pelo menos ${SENHA_MIN} caracteres`);
  try {
    const { rows } = await db.query<{ id: string; email: string; nome: string; papel: Papel }>(
      "insert into usuarios (email, nome, senha_hash, empresa_id, papel) values ($1, $2, $3, $4, $5) returning id, email, nome, papel",
      [email, nome.trim(), await gerarHash(senha), empresaId, papel],
    );
    return rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ErroUsuario(409, `Já existe um usuário com o e-mail ${email}`);
    throw e;
  }
}

export async function redefinirSenha(db: Db, email: string, senha: string): Promise<void> {
  if (senha.length < SENHA_MIN) throw new ErroUsuario(400, `A senha precisa ter pelo menos ${SENHA_MIN} caracteres`);
  const { rowCount } = await db.query("update usuarios set senha_hash = $2 where email = $1", [normalizarEmail(email), await gerarHash(senha)]);
  if (!rowCount) throw new ErroUsuario(404, `Usuário ${email} não encontrado`);
  erros.delete(normalizarEmail(email) ?? "");
}

export async function definirAtivo(db: Db, email: string, ativo: boolean): Promise<void> {
  const { rowCount } = await db.query("update usuarios set ativo = $2 where email = $1", [normalizarEmail(email), ativo]);
  if (!rowCount) throw new ErroUsuario(404, `Usuário ${email} não encontrado`);
}

export async function listarUsuarios(db: Db) {
  const { rows } = await db.query<{ id: string; email: string; nome: string; papel: Papel; ativo: boolean; ultimo_login: Date | null; empresa: string }>(
    `select u.id, u.email, u.nome, u.papel, u.ativo, u.ultimo_login, e.nome as empresa
       from usuarios u join empresas e on e.id = u.empresa_id order by e.nome, u.email`,
  );
  return rows;
}

/** Senha aleatória legível (sem caracteres ambíguos), para criar ou redefinir sem digitar. */
export function senhaAleatoria(tamanho = 14): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...randomBytes(tamanho)].map((b) => letras[b % letras.length]).join("");
}
