// Exportação no formato da planilha atual (seção 8).
import { depreciacaoDe } from "@/config/avaliacao";
import type { AvaliacaoImovel, Imovel } from "./contrato";
import { enderecoCompleto } from "./formatar";

const COLUNAS = [
  "Nº", "Endereço com nº", "Bairro", "Área construída (m²)", "Área do terreno (m²)", "Preço total (R$)",
  "Preço/m² (R$)", "Pavimentos", "Condomínio", "Dormitórios", "Suítes", "Banheiros", "Vagas cobertas",
  "Vagas descobertas", "Vagas total", "Área de lazer / churrasqueira", "Piscina", "Padrão de acabamento (VEIU)", "Idade", "Estado IBAPE", "Depreciação IBAPE (%)", "Data do evento",
  "Informante", "Contato", "Fonte de pesquisa", "Link do anúncio", "Observações",
];
// Percentual do Quadro 1 do IBAPE: sempre com duas casas ("0,00", "0,32").
const COL_DEPRECIACAO = COLUNAS.indexOf("Depreciação IBAPE (%)");

type Linha = (string | number | null)[];

function linhas(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>): Linha[] {
  return imoveis.map((i, n) => {
    const a = avaliacoes[i.id];
    const bool = (v: boolean | null) => (v === null ? null : v ? "Sim" : "Não");
    const estado = a?.estado_conservacao || i.estado_conservacao_anuncio;
    return [
      n + 1,
      i.endereco.logradouro ? enderecoCompleto(i) : null,
      i.endereco.bairro,
      i.area_construida_m2,
      i.area_terreno_m2,
      i.preco_total,
      i.preco_m2,
      i.pavimentos,
      bool(i.condominio),
      i.dormitorios,
      i.suites,
      i.banheiros,
      i.vagas_cobertas,
      i.vagas_descobertas,
      i.vagas_total,
      bool(i.area_lazer ?? null),
      bool(i.piscina ?? null),
      a?.padrao_acabamento || i.padrao_acabamento_anuncio,
      null, // idade: não publicada pelas fontes; preenchida pela avaliadora
      estado,
      depreciacaoDe(estado),
      i.data_anuncio ? i.data_anuncio.split("-").reverse().join("/") : null,
      i.fonte.informante,
      i.fonte.contato,
      i.fonte.nome,
      i.url_anuncio,
      a?.observacoes || null,
    ];
  });
}

/** Só os itens marcados como "Incluir na avaliação": nada além do que a avaliadora selecionou vai para a planilha. */
export function selecionarParaExportar(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>): Imovel[] {
  return imoveis.filter((i) => avaliacoes[i.id]?.incluido_avaliacao === true);
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  a.click();
  URL.revokeObjectURL(url);
}

/** "Casa Adriana" → casa-adriana-2026-10-28.xlsx; sem pesquisa salva, pesquisa-imoveis-2026-10-28.xlsx. */
const nomeArquivo = (ext: string, pesquisa?: string) => {
  const base = pesquisa ? pesquisa.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
  return `${base || "pesquisa-imoveis"}-${new Date().toISOString().slice(0, 10)}.${ext}`;
};

export function exportarCsv(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>, pesquisa?: string) {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" e BOM para o Excel em português abrir direto.
  const celula = (v: string | number | null, c: number) => (c === COL_DEPRECIACAO && typeof v === "number" ? v.toFixed(2).replace(".", ",") : v);
  const csv = [COLUNAS, ...linhas(imoveis, avaliacoes)].map((l) => l.map((v, c) => esc(celula(v, c))).join(";")).join("\r\n");
  baixar(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), nomeArquivo("csv", pesquisa));
}

export async function exportarXlsx(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>, pesquisa?: string) {
  const XLSX = await import("xlsx");
  const planilha = XLSX.utils.aoa_to_sheet([COLUNAS, ...linhas(imoveis, avaliacoes)]);
  planilha["!cols"] = COLUNAS.map((c) => ({ wch: Math.max(10, c.length + 2) }));
  // Número com formato 0,00 (continua somável no Excel).
  for (let r = 1; r <= imoveis.length; r++) {
    const cel = planilha[XLSX.utils.encode_cell({ r, c: COL_DEPRECIACAO })];
    if (cel && cel.t === "n") cel.z = "0.00";
  }
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Pesquisa");
  const dados = XLSX.write(livro, { type: "array", bookType: "xlsx" });
  baixar(new Blob([dados], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomeArquivo("xlsx", pesquisa));
}
