// Proteção contra SSRF: o servidor só baixa fotos de endereços públicos.
// Sem "server-only" de propósito, para os testes (node --test) importarem; só código do servidor usa.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

// Faixas que o servidor nunca deve acessar. O BlockList também reconhece IPv4 dentro de IPv6
// (::ffff:7f00:1 = 127.0.0.1), que a checagem por texto deixava passar.
const BLOQUEADOS = new net.BlockList();
for (const [rede, prefixo] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOQUEADOS.addSubnet(rede, prefixo, "ipv4");
for (const [rede, prefixo] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) BLOQUEADOS.addSubnet(rede, prefixo, "ipv6");

export function ipPrivado(ip: string): boolean {
  const familia = net.isIP(ip);
  if (!familia) return true;
  return BLOQUEADOS.check(ip, familia === 4 ? "ipv4" : "ipv6");
}

export async function urlPermitida(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host)) return !ipPrivado(host);
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    const enderecos = await dns.lookup(host, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipPrivado(e.address));
  } catch {
    return false;
  }
}

// O DNS pode responder um IP público na checagem acima e um interno na hora do download (DNS rebinding).
// Por isso o download usa este lookup, que confere o IP no momento exato da conexão.
const lookupSeguro: net.LookupFunction = (host, opcoes, callback) => {
  dns.lookup(host, { ...opcoes, all: true }).then(
    (enderecos) => {
      const publicos = enderecos.filter((e) => !ipPrivado(e.address));
      if (publicos.length === 0 || publicos.length !== enderecos.length) {
        const erro = Object.assign(new Error(`endereço não permitido: ${host}`), { code: "ENDERECO_BLOQUEADO" });
        return (callback as (e: Error) => void)(erro);
      }
      if ((opcoes as { all?: boolean }).all) return (callback as (e: null, a: typeof publicos) => void)(null, publicos);
      callback(null, publicos[0].address, publicos[0].family);
    },
    (e) => (callback as (e: Error) => void)(e),
  );
};

/** fetch só para as fotos: GET sem seguir redirecionamentos, conectando apenas a IPs públicos. */
export const fetchFoto: typeof fetch = (entrada, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(entrada instanceof Request ? entrada.url : entrada.toString());
    if (url.protocol !== "http:" && url.protocol !== "https:") return reject(new TypeError("protocolo não permitido"));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && ipPrivado(host)) return reject(Object.assign(new Error("endereço não permitido"), { code: "ENDERECO_BLOQUEADO" }));
    const cliente = url.protocol === "https:" ? https : http;
    const req = cliente.request(url, {
      method: "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      lookup: lookupSeguro,
      signal: init.signal ?? undefined,
    }, (res) => {
      const headers = new Headers();
      for (const [nome, valor] of Object.entries(res.headers)) {
        if (valor === undefined) continue;
        for (const v of Array.isArray(valor) ? valor : [valor]) headers.append(nome, v);
      }
      const status = res.statusCode ?? 502;
      const semCorpo = status === 204 || status === 304 || (status >= 300 && status < 400);
      if (semCorpo) res.resume();
      resolve(new Response(semCorpo ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers }));
    });
    req.on("error", reject);
    req.end();
  });
