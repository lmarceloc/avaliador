import type { Metadata } from "next";
import { Suspense } from "react";
import { FormLogin } from "@/components/FormLogin";

export const metadata: Metadata = { title: "Entrar – Busca de Imóveis" };

export default function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      {/* useSearchParams lê o ?volta= na hora da requisição: fica atrás do Suspense. */}
      <Suspense>
        <FormLogin />
      </Suspense>
    </main>
  );
}
