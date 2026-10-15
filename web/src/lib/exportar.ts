// Exportação no formato da planilha atual (seção 8).
import type { AvaliacaoImovel, Imovel } from "./contrato";
import { enderecoCompleto } from "./formatar";

const COLUNAS = [
  "Nº", "Endereço com nº", "Bairro", "Área construída (m²)", "Área do terreno (m²)", "Preço total (R$)",
  "Preço/m² (R$)", "Pavimentos", "Condomínio", "Dormitórios", "Suítes", "Banheiros", "Vagas cobertas",
  "Vagas descobertas", "Vagas total", "Padrão de acabamento (VEIU)", "Idade", "Estado IBAPE", "Data do evento",
  "Informante", "Contato", "Fonte de pesquisa", "Link do anúncio",
];

type Linha = (string | number | null)[];

function linhas(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>): Linha[] {
  return imoveis.map((i, n) => {
    const a = avaliacoes[i.id];
    const bool = (v: boolean | null) => (v === null ? null : v ? "Sim" : "Não");
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
      a?.padrao_acabamento || i.padrao_acabamento_anuncio,
      null, // idade: não publicada pelas fontes; preenchida pela avaliadora
      a?.estado_conservacao || i.estado_conservacao_anuncio,
      i.data_anuncio ? i.data_anuncio.split("-").reverse().join("/") : null,
      i.fonte.informante,
      i.fonte.contato,
      i.fonte.nome,
      i.url_anuncio,
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

const nomeArquivo = (ext: string) => `pesquisa-imoveis-${new Date().toISOString().slice(0, 10)}.${ext}`;

export function exportarCsv(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>) {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" e BOM para o Excel em português abrir direto.
  const csv = [COLUNAS, ...linhas(imoveis, avaliacoes)].map((l) => l.map(esc).join(";")).join("\r\n");
  baixar(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), nomeArquivo("csv"));
}

export async function exportarXlsx(imoveis: Imovel[], avaliacoes: Record<string, AvaliacaoImovel>) {
  const XLSX = await import("xlsx");
  const planilha = XLSX.utils.aoa_to_sheet([COLUNAS, ...linhas(imoveis, avaliacoes)]);
  planilha["!cols"] = COLUNAS.map((c) => ({ wch: Math.max(10, c.length + 2) }));
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Pesquisa");
  const dados = XLSX.write(livro, { type: "array", bookType: "xlsx" });
  baixar(new Blob([dados], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomeArquivo("xlsx"));
}
