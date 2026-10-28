/** Só aceita caminhos internos ("/..."), para o "voltar para" do login não virar redirecionamento para fora. */
export const caminhoSeguro = (v: string | null | undefined) => (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/");
