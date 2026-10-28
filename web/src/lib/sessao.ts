// Sessão de login num cookie HttpOnly assinado (HMAC-SHA256 com SESSAO_SEGREDO). Sem estado no servidor:
// o backend confere e-mail e senha no login; daí em diante o proxy só valida a assinatura e a validade.
// Usado pelo proxy e pelas rotas (ambos rodam em Node.js).
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_SESSAO = "avaliador_sessao";
export const DURACAO_SESSAO_S = 7 * 24 * 60 * 60;

export interface Sessao {
  id: string;
  email: string;
  nome: string;
  /** Expiração, em segundos desde 1970. */
  exp: number;
}

/** Com backend configurado o login é obrigatório; sem ele (busca simulada, desenvolvimento) o site fica aberto. */
export const loginObrigatorio = (env: Record<string, string | undefined> = process.env) => Boolean(env.BACKEND_URL);

/** O segredo precisa de pelo menos 32 caracteres; sem ele não há como assinar a sessão. */
export function segredoSessao(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.SESSAO_SEGREDO;
  return s && s.length >= 32 ? s : null;
}

const assinar = (dados: string, segredo: string) => createHmac("sha256", segredo).update(dados).digest("base64url");

export function criarToken(u: Omit<Sessao, "exp">, segredo: string, agora = Date.now()): string {
  const sessao: Sessao = { id: u.id, email: u.email, nome: u.nome, exp: Math.floor(agora / 1000) + DURACAO_SESSAO_S };
  const dados = Buffer.from(JSON.stringify(sessao)).toString("base64url");
  return `${dados}.${assinar(dados, segredo)}`;
}

/** Devolve a sessão se a assinatura confere e não venceu; senão null. */
export function lerToken(token: string | undefined, segredo: string, agora = Date.now()): Sessao | null {
  if (!token) return null;
  const [dados, assinatura, ...resto] = token.split(".");
  if (!dados || !assinatura || resto.length) return null;
  const esperada = Buffer.from(assinar(dados, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const s = JSON.parse(Buffer.from(dados, "base64url").toString("utf8")) as Sessao;
    return typeof s.exp === "number" && s.exp * 1000 > agora && s.id && s.email ? s : null;
  } catch {
    return null;
  }
}
