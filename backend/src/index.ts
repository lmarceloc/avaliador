// Entrada do serviço: aplica as migrações, encerra buscas órfãs, agenda a limpeza do cache e sobe a API.
import { encerrarBuscasInterrompidas, limparBuscasExpiradas } from "./buscas";
import { executarColeta } from "./coleta";
import { criarPool, migrar } from "./db";
import { criarServidor } from "./servidor";

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.API_KEY;
const PORTA = Number(process.env.PORT || 3000);
if (!DATABASE_URL) throw new Error("DATABASE_URL não definida");
if (!API_KEY || API_KEY.length < 24) throw new Error("API_KEY não definida ou curta demais (mínimo 24 caracteres)");

const pool = criarPool(DATABASE_URL);
const aplicadas = await migrar(pool);
if (aplicadas.length) log(`migrações aplicadas: ${aplicadas.join(", ")}`);
const orfas = await encerrarBuscasInterrompidas(pool);
if (orfas) log(`${orfas} busca(s) interrompida(s) marcadas como erro`);

const UMA_HORA = 60 * 60 * 1000;
const limpeza = setInterval(() => {
  limparBuscasExpiradas(pool)
    .then((n) => n && log(`${n} busca(s) expirada(s) apagadas`))
    .catch((e) => log(`limpeza falhou: ${(e as Error).message}`));
}, UMA_HORA);

const servidor = criarServidor({
  db: pool,
  apiKey: API_KEY,
  log,
  coletar: async (req) => {
    const r = await executarColeta(req);
    log(`busca ${req.requisicao_id}: ${r.status} · ${r.fontes_status.map((f) => `${f.id}=${f.status}(${f.itens})`).join(" ")}`);
    for (const linha of r.logs) log(`  ${linha}`);
    return r;
  },
});
servidor.listen(PORTA, () => log(`backend do avaliador na porta ${PORTA}`));

// O EasyPanel manda SIGTERM no redeploy: para de aceitar conexões e fecha o banco.
// Buscas em andamento são perdidas e viram erro na próxima subida (encerrarBuscasInterrompidas).
for (const sinal of ["SIGTERM", "SIGINT"] as const)
  process.on(sinal, () => {
    log(`${sinal}: encerrando`);
    clearInterval(limpeza);
    servidor.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
