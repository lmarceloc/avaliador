// Cadastro de empresas e usuários do site, pelo console do serviço backend no EasyPanel (DATABASE_URL já existe lá).
// Cada usuário pertence a uma empresa e só vê as pesquisas e análises dela.
//
//   node dist/usuarios.mjs empresas                                       → lista as empresas
//   node dist/usuarios.mjs empresa-criar "<Nome da empresa>"
//   node dist/usuarios.mjs empresa-desativar "<Nome da empresa>"          → ninguém da empresa entra mais
//   node dist/usuarios.mjs empresa-ativar "<Nome da empresa>"
//
//   node dist/usuarios.mjs listar
//   node dist/usuarios.mjs criar <email> "<Nome completo>" [--empresa "<Nome>"] [--admin]
//        → mostra uma senha gerada (a pessoa troca no site em "Trocar senha"). --empresa pode ficar de fora
//          enquanto houver uma empresa só.
//   node dist/usuarios.mjs senha <email>                     → gera uma senha nova e mostra
//   node dist/usuarios.mjs desativar <email>                 → perde o acesso na hora
//   node dist/usuarios.mjs ativar <email>
import { criarPool, migrar } from "../src/db";
import {
  acharEmpresa, criarEmpresa, criarUsuario, definirAtivo, definirEmpresaAtiva, ErroUsuario, listarEmpresas, listarUsuarios,
  redefinirSenha, senhaAleatoria,
} from "../src/usuarios";

// Separa as opções (--empresa "X", --admin) dos argumentos posicionais.
const args = process.argv.slice(2);
const posicionais: string[] = [];
const opcoes: { empresa?: string; admin?: boolean } = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--empresa") opcoes.empresa = args[++i];
  else if (args[i] === "--admin") opcoes.admin = true;
  else posicionais.push(args[i]);
}
const [comando, email, nome] = posicionais;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const AJUDA = `Comandos:
  empresas | empresa-criar "<Nome>" | empresa-desativar "<Nome>" | empresa-ativar "<Nome>"
  listar | criar <email> "<Nome>" [--empresa "<Nome>"] [--admin] | senha <email> | desativar <email> | ativar <email>`;

const pool = criarPool(DATABASE_URL);
try {
  await migrar(pool);
  switch (comando) {
    case "empresas": {
      const lista = await listarEmpresas(pool);
      if (!lista.length) console.log("Nenhuma empresa cadastrada.");
      for (const e of lista) console.log(`${e.ativa ? "ativa  " : "inativa"}  ${e.nome.padEnd(32)} ${e.usuarios} usuário(s)`);
      break;
    }
    case "empresa-criar": {
      if (!email) throw new ErroUsuario(400, 'Uso: node dist/usuarios.mjs empresa-criar "<Nome da empresa>"');
      const e = await criarEmpresa(pool, email);
      console.log(`Empresa criada: ${e.nome}\nAgora crie os usuários dela: node dist/usuarios.mjs criar <email> "<Nome>" --empresa "${e.nome}" --admin`);
      break;
    }
    case "empresa-desativar":
    case "empresa-ativar": {
      if (!email) throw new ErroUsuario(400, `Uso: node dist/usuarios.mjs ${comando} "<Nome da empresa>"`);
      const ativa = comando === "empresa-ativar";
      await definirEmpresaAtiva(pool, email, ativa);
      console.log(`${email}: ${ativa ? "ativada" : "desativada"}`);
      break;
    }
    case "listar": {
      const lista = await listarUsuarios(pool);
      if (!lista.length) console.log("Nenhum usuário cadastrado.");
      for (const u of lista)
        console.log(
          `${u.ativo ? "ativo  " : "inativo"}  ${u.empresa.padEnd(24)} ${u.papel.padEnd(6)} ${u.email.padEnd(32)} ${u.nome}  (último login: ${u.ultimo_login?.toLocaleString("pt-BR") ?? "nunca"})`,
        );
      break;
    }
    case "criar": {
      if (!email || !nome) throw new ErroUsuario(400, 'Uso: node dist/usuarios.mjs criar <email> "<Nome completo>" [--empresa "<Nome>"] [--admin]');
      const empresa = await acharEmpresa(pool, opcoes.empresa);
      const senha = senhaAleatoria();
      const u = await criarUsuario(pool, email, nome, senha, empresa.id, opcoes.admin ? "admin" : "membro");
      console.log(`Usuário criado: ${u.email} (${u.nome}) na empresa ${empresa.nome}, papel ${u.papel}\nSenha: ${senha}\nPeça para trocar no site em "Trocar senha".`);
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
      console.log(AJUDA);
  }
} catch (e) {
  console.error(e instanceof ErroUsuario ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
