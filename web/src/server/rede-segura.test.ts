import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchFoto, ipPrivado, urlPermitida } from "./rede-segura.ts";

test("ipPrivado bloqueia redes internas, inclusive IPv4 escrito dentro de IPv6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1",
    "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "nao-e-ip"])
    assert.equal(ipPrivado(ip), true, ip);
  for (const ip of ["8.8.8.8", "200.147.67.142", "2606:4700:4700::1111", "::ffff:808:808"]) assert.equal(ipPrivado(ip), false, ip);
});

test("urlPermitida recusa as formas alternativas de escrever o localhost", async () => {
  for (const url of ["http://[::ffff:127.0.0.1]/a.jpg", "http://[::ffff:a9fe:a9fe]/latest/meta-data/", "http://0x7f.1/", "http://2130706433/",
    "http://localhost:3000/", "http://[64:ff9b::7f00:1]/"])
    assert.equal(await urlPermitida(url), false, url);
  assert.equal(await urlPermitida("http://8.8.8.8/foto.jpg"), true);
});

test("fetchFoto não conecta em IP interno, nem quando o nome resolve para ele (DNS rebinding)", async (t) => {
  const servidor = http.createServer((_q, r) => r.end("segredo interno")).listen(0, "127.0.0.1");
  t.after(() => servidor.close());
  await new Promise((r) => servidor.once("listening", r));
  const { port } = servidor.address() as AddressInfo;
  await assert.rejects(fetchFoto(`http://127.0.0.1:${port}/`));
  await assert.rejects(fetchFoto(`http://[::ffff:7f00:1]:${port}/`));
  await assert.rejects(fetchFoto(`http://localhost:${port}/`), /endereço não permitido/);
  await assert.rejects(fetchFoto("file:///etc/passwd"), /protocolo/);
});
