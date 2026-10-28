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

export interface Usuario {
  id: string;
  email: string;
  nome: string;
}

const PARAMS = { N: 16384, r: 8, p: 1 };
const TAMANHO = 64;
export const SENHA_MIN = 8;
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CREDENCIAIS_INVALIDAS = "E-mail ou senha inválidos";

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

  const { rows } = await db.query<Usuario & { senha_hash: string }>(
    "select id, email, nome, senha_hash from usuarios where email = $1 and ativo",
    [email],
  );
  const ok = await conferirSenha(senha, rows[0]?.senha_hash ?? (await hashFalso));
  if (!rows[0] || !ok) {
    const bloqueioVencido = registro !== undefined && registro.ate !== 0;
    const n = (bloqueioVencido ? 0 : registro?.n ?? 0) + 1;
    erros.set(email, { n, ate: n >= MAX_ERROS ? agora + BLOQUEIO_MS : 0 });
    throw new ErroUsuario(401, CREDENCIAIS_INVALIDAS);
  }
  erros.delete(email);
  await db.query("update usuarios set ultimo_login = now() where id = $1", [rows[0].id]);
  return { id: rows[0].id, email: rows[0].email, nome: rows[0].nome };
}

export async function trocarSenha(db: Db, email: unknown, atual: unknown, nova: unknown): Promise<void> {
  if (typeof nova !== "string" || nova.length < SENHA_MIN) throw new ErroUsuario(400, `A senha nova precisa ter pelo menos ${SENHA_MIN} caracteres`);
  const u = await autenticar(db, email, atual);
  await db.query("update usuarios set senha_hash = $2 where id = $1", [u.id, await gerarHash(nova)]);
}

// ---------- Cadastro (console do backend) ----------

export async function criarUsuario(db: Db, emailBruto: string, nome: string, senha: string): Promise<Usuario> {
  const email = normalizarEmail(emailBruto);
  if (!email) throw new ErroUsuario(400, "E-mail inválido");
  if (!nome.trim()) throw new ErroUsuario(400, "Informe o nome");
  if (senha.length < SENHA_MIN) throw new ErroUsuario(400, `A senha precisa ter pelo menos ${SENHA_MIN} caracteres`);
  try {
    const { rows } = await db.query<Usuario>(
      "insert into usuarios (email, nome, senha_hash) values ($1, $2, $3) returning id, email, nome",
      [email, nome.trim(), await gerarHash(senha)],
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
  const { rows } = await db.query<Usuario & { ativo: boolean; ultimo_login: Date | null }>(
    "select id, email, nome, ativo, ultimo_login from usuarios order by email",
  );
  return rows;
}

/** Senha aleatória legível (sem caracteres ambíguos), para criar ou redefinir sem digitar. */
export function senhaAleatoria(tamanho = 14): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...randomBytes(tamanho)].map((b) => letras[b % letras.length]).join("");
}
