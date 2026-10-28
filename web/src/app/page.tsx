import { Suspense } from "react";
import { BuscaApp } from "@/components/BuscaApp";
import { MenuUsuario } from "@/components/MenuUsuario";
import { sessaoAtual } from "@/server/sessao-atual";

// O cookie da sessão só existe na requisição: o menu do usuário fica atrás do Suspense e o resto da página
// continua no shell pré-renderizado.
async function Usuario() {
  const sessao = await sessaoAtual();
  return sessao ? <MenuUsuario nome={sessao.nome} email={sessao.email} /> : null;
}

export default function Home() {
  return (
    <BuscaApp
      menuUsuario={
        <Suspense>
          <Usuario />
        </Suspense>
      }
    />
  );
}
