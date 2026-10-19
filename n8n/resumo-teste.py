# Resumo do build/ultimo-teste.json por fonte: quantidade, detalhados, campos preenchidos e exemplos.
import json, collections, sys
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "build/ultimo-teste.json"))
print("fontes:", [(f["id"], f["status"], f.get("itens"), f.get("mensagem", "")) for f in d["coleta"]])
por = collections.defaultdict(list)
for i in d["imoveis"]:
    por[i["fonte"]["id"]].append(i)
    for a in i["fontes_alternativas"]: por[a["id"]+"(alt)"].append(i)
for f, it in por.items():
    if f.endswith("(alt)"): print(f, len(it)); continue
    det = [i for i in it if i.get("detalhe_coletado")]
    campos = ["preco_total", "area_construida_m2", "area_terreno_m2", "dormitorios", "suites", "banheiros", "vagas_total", "endereco.bairro", "endereco.logradouro"]
    val = lambda i, c: i["endereco"][c.split(".")[1]] if c.startswith("endereco.") else i[c]
    cheio = {c: sum(val(i, c) is not None for i in det) for c in campos}
    fotos = sorted(len(i["fotos"]) for i in det) or [0]
    print(f"== {f}: {len(it)} imóveis, {len(det)} detalhados, fotos mediana {fotos[len(fotos)//2]} | " + " ".join(f"{c.split('.')[-1]}={v}" for c, v in cheio.items()))
    for i in (det or it)[:2]:
        print(f"   {i['id']} | {i['tipo']} | {i['endereco']['bairro']} | {i['endereco']['logradouro']}, {i['endereco']['numero']} | R$ {i['preco_total']} | {i['area_construida_m2']}/{i['area_terreno_m2']} m² | {i['dormitorios']}q {i['suites']}s {i['banheiros']}b {i['vagas_total']}v | {len(i['fotos'])} fotos | {i['titulo'][:40]} | {i['url_anuncio']}")
