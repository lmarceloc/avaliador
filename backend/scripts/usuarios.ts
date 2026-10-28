// Cadastro de usuários do site, pelo console do serviço backend no EasyPanel (DATABASE_URL já existe lá).
//
//   node dist/usuarios.mjs listar
//   node dist/usuarios.mjs criar <email> "<Nome completo>"   → mostra uma senha gerada (a pessoa troca no site em "Trocar senha")
//   node dist/usuarios.mjs senha <email>                     → gera uma senha nova e mostra
//   node dist/usuarios.mjs desativar <email>                 → não entra mais (sessão já aberta vale até expirar, 7 dias)
//   node dist/usuarios.mjs ativar <email>
import { criarPool, migrar } from "../src/db";
import { criarUsuario, definirAtivo, ErroUsuario, listarUsuarios, redefinirSenha, senhaAleatoria } from "../src/usuarios";

const [comando, email, nome] = process.argv.slice(2);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const pool = criarPool(DATABASE_URL);
try {
  await migrar(pool);
  switch (comando) {
    case "listar": {
      const lista = await listarUsuarios(pool);
      if (!lista.length) console.log("Nenhum usuário cadastrado.");
      for (const u of lista)
        console.log(`${u.ativo ? "ativo  " : "inativo"}  ${u.email.padEnd(32)} ${u.nome}  (último login: ${u.ultimo_login?.toLocaleString("pt-BR") ?? "nunca"})`);
      break;
    }
    case "criar": {
      if (!email || !nome) throw new ErroUsuario(400, 'Uso: node dist/usuarios.mjs criar <email> "<Nome completo>"');
      const senha = senhaAleatoria();
      const u = await criarUsuario(pool, email, nome, senha);
      console.log(`Usuário criado: ${u.email} (${u.nome})\nSenha: ${senha}\nPeça para trocar no site em "Trocar senha".`);
      break;
    }
    case "senha": {
      if (!email) throw new ErroUsuario(400, "Uso: node dist/usuarios.mjs senha <email>");
      const senha = senhaAleatoria();
      await redefinirSenha(pool, email, senha);
      console.log(`Senha nova de ${email}: ${senha}`);
      break;
    }
    case "desativar":
    case "ativar":
      if (!email) throw new ErroUsuario(400, `Uso: node dist/usuarios.mjs ${comando} <email>`);
      await definirAtivo(pool, email, comando === "ativar");
      console.log(`${email}: ${comando === "ativar" ? "ativado" : "desativado"}`);
      break;
    default:
      console.log('Comandos: listar | criar <email> "<Nome>" | senha <email> | desativar <email> | ativar <email>');
  }
} catch (e) {
  console.error(e instanceof ErroUsuario ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
