#!/usr/bin/env python3
"""Validador do "pacote de importação" do editor SPED EFD-Contribuições.

Uso:
    python3 validar_pacote.py pacote.json [--max N]

Confere o arquivo contra o contrato (src/core/importacao.tipos.ts):
estrutura, campos obrigatórios, formatos e coerências.
  - ERRO bloqueia: o programa termina com código 1 e o pacote NÃO deve ser entregue.
  - ALERTA não bloqueia: precisa ser lido e, se for o caso, explicado ao usuário.

Usa somente a biblioteca padrão do Python 3.
"""
import datetime
import json
import re
import sys
from collections import Counter, defaultdict
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# --------------------------------------------------------------------------
# Tabelas
# --------------------------------------------------------------------------
CST_PIS_COFINS = (
    {"01", "02", "03", "04", "05", "06", "07", "08", "09", "49"}
    | {f"{n:02d}" for n in range(50, 57)}
    | {f"{n:02d}" for n in range(60, 68)}
    | {f"{n:02d}" for n in range(70, 76)}
    | {"98", "99"}
)
CST_SAIDA = {f"{n:02d}" for n in range(1, 10)} | {"49", "99"}
CST_ENTRADA_CREDITO = {f"{n:02d}" for n in range(50, 57)} | {f"{n:02d}" for n in range(60, 67)}
CST_ENTRADA = {f"{n:02d}" for n in range(50, 99)} | {"98", "99", "49"}
NAT_BC_CRED = {f"{n:02d}" for n in range(1, 19)}
TIPO_ITEM = {"00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "99"}
IND_FRT = {"0", "1", "2", "3", "4", "9"}
IND_NAT_FRT = {"0", "1", "2", "3", "4", "5", "9"}
SITUACAO = {f"{n:02d}" for n in range(0, 9)}
MODELOS_ENERGIA = {"06", "28", "29", "55", "66"}
CST_CREDITO_SERVICO = {f"{n:02d}" for n in range(50, 67)}          # 50 a 66: crédito (contrato do serviço)
CST_SEM_CREDITO = {f"{n:02d}" for n in range(70, 76)} | {"98", "99"}  # sem crédito / outras entradas
IDENT_BEM = {"01", "02", "03", "04", "05", "06", "99"}
UTIL_BEM = {"1", "2", "3", "9"}
NAT_BC_F120 = {"09", "11"}
NAT_BC_F130 = {"10"}
MESES_PARCELAS = {"1": 1, "2": 12, "3": 24, "4": 48, "5": 6}      # IND_NR_PARC -> nº de meses (9 = informar baseMes)
LIMITE_ITENS = 20000
TOL = Decimal("0.01")
CENT = Decimal("0.01")

TIPOS_DOC = ("nota", "itens", "frete", "energia", "f100", "servico", "imobilizado")

CAMPOS = {
    "topo": {"formato", "versao", "cnpj", "origem", "documentos"},
    "participante": {"cnpjCpf", "nome", "ie", "codMunicipio", "codPais", "endereco", "numero",
                     "complemento", "bairro", "suframa"},
    "tributo": {"cst", "base", "aliquota", "valor"},
    "item": {"codigo", "descricao", "ncm", "unidade", "tipoItem", "quantidade", "valorItem",
             "valorDesconto", "cfop", "natOperacao", "icms", "ipi", "pis", "cofins", "contaContabil"},
    "icms_item": {"cst", "base", "aliquota", "valor", "baseSt", "aliquotaSt", "valorSt"},
    "ipi_item": {"cst", "base", "aliquota", "valor"},
    "natOperacao": {"codigo", "descricao"},
    "credito": {"valorItem", "cst", "natBcCred", "base", "aliquotaPis", "aliquotaCofins", "contaContabil"},
    "totais": {"documento", "mercadorias", "desconto", "frete", "seguro", "outrasDespesas"},
    "icms_frete": {"base", "valor", "naoTributado"},
    "nota_ref": {"chave", "numero", "serie", "cnpjCpfParticipante"},
    "nota": {"tipo", "periodo", "referencia", "operacao", "emissao", "modelo", "situacao", "serie",
             "numero", "chave", "dataDocumento", "dataEntradaSaida", "participante", "indPagamento",
             "indFrete", "totais", "itens"},
    "itens": {"tipo", "periodo", "referencia", "nota", "itens"},
    "frete": {"tipo", "periodo", "referencia", "operacao", "emissao", "modelo", "situacao", "serie",
              "subserie", "numero", "chave", "dataDocumento", "dataEntradaSaida", "participante",
              "valorDocumento", "valorDesconto", "indFrete", "valorServico", "icms", "natFrete",
              "creditos", "contaContabil"},
    "energia": {"tipo", "periodo", "referencia", "modelo", "situacao", "serie", "subserie", "numero",
                "chave", "dataDocumento", "dataEntrada", "participante", "valorDocumento",
                "valorIcms", "creditos"},
    "f100": {"tipo", "periodo", "referencia", "indOper", "participante", "codItem", "data", "valor",
             "pis", "cofins", "natBcCred", "indOrigCred", "contaContabil", "centroCusto", "descricao"},
    "item_servico": {"codigo", "descricao", "codigoServico", "unidade", "descricaoComplementar", "valorItem",
                     "valorDesconto", "natBcCred", "indOrigCred", "pis", "cofins", "contaContabil", "centroCusto"},
    "servico": {"tipo", "periodo", "referencia", "operacao", "emissao", "situacao", "serie", "subserie",
                "numero", "chave", "dataDocumento", "dataExecucao", "participante", "indPagamento",
                "valorDocumento", "valorDesconto", "pisRetido", "cofinsRetido", "valorIss", "itens"},
    "imobilizado": {"tipo", "periodo", "referencia", "modalidade", "natBcCred", "identificacaoBem",
                    "indOrigCred", "utilizacao", "valorEncargo", "mesAquisicao", "valorAquisicao",
                    "parcelaSemCredito", "parcelas", "baseMes", "pis", "cofins", "contaContabil",
                    "centroCusto", "descricao"},
}


# --------------------------------------------------------------------------
# Dígitos verificadores
# --------------------------------------------------------------------------
def cnpj_valido(c):
    if len(c) != 14 or not c.isdigit() or len(set(c)) == 1:
        return False
    def dv(base, pesos):
        r = sum(int(d) * p for d, p in zip(base, pesos)) % 11
        return "0" if r < 2 else str(11 - r)
    d1 = dv(c[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = dv(c[:12] + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return c[12:] == d1 + d2


def cpf_valido(c):
    if len(c) != 11 or not c.isdigit() or len(set(c)) == 1:
        return False
    def dv(base):
        soma = sum(int(d) * p for d, p in zip(base, range(len(base) + 1, 1, -1)))
        r = (soma * 10) % 11
        return "0" if r == 10 else str(r)
    d1 = dv(c[:9])
    d2 = dv(c[:9] + d1)
    return c[9:] == d1 + d2


def chave_dv_valido(ch):
    """Dígito verificador módulo 11 da chave de acesso (44 dígitos)."""
    if len(ch) != 44 or not ch.isdigit():
        return False
    soma, peso = 0, 2
    for d in reversed(ch[:43]):
        soma += int(d) * peso
        peso = 2 if peso == 9 else peso + 1
    r = soma % 11
    dv = 0 if r in (0, 1) else 11 - r
    return int(ch[43]) == dv


# --------------------------------------------------------------------------
# Contexto de relato
# --------------------------------------------------------------------------
class Ctx:
    def __init__(self):
        self.erros = []
        self.alertas = []
        self.doc = None  # (indice 1-based, tipo, referencia) ou None para o topo

    def erro(self, caminho, msg):
        self.erros.append((self.doc, caminho, msg))

    def alerta(self, caminho, msg):
        self.alertas.append((self.doc, caminho, msg))


def junta(base, chave):
    return f"{base}.{chave}" if base else chave


def tipo_json(v):
    if v is None:
        return "nulo"
    if isinstance(v, bool):
        return "verdadeiro/falso"
    if isinstance(v, (int, float)):
        return "número"
    if isinstance(v, str):
        return "texto"
    if isinstance(v, list):
        return "lista"
    return "objeto"


# --------------------------------------------------------------------------
# Leitores de campos
# --------------------------------------------------------------------------
def checa_chaves(c, o, base, nome_conjunto):
    for k in o:
        if k not in CAMPOS[nome_conjunto]:
            c.alerta(junta(base, k), f"campo desconhecido '{k}' (será ignorado; confira se não é erro de digitação)")


def exige_objeto(c, o, base, chave, obrig, nome_conjunto=None):
    if chave not in o or o[chave] is None:
        if obrig:
            c.erro(junta(base, chave), "campo obrigatório ausente")
        elif chave in o:
            c.alerta(junta(base, chave), "valor nulo; omita o campo em vez de enviar null")
        return None
    v = o[chave]
    if not isinstance(v, dict):
        c.erro(junta(base, chave), f"deve ser um objeto, veio {tipo_json(v)}")
        return None
    if nome_conjunto:
        checa_chaves(c, v, junta(base, chave), nome_conjunto)
    return v


def le_texto(c, o, base, chave, obrig=False, regex=None, descricao=None):
    caminho = junta(base, chave)
    if chave not in o or o[chave] is None:
        if obrig:
            c.erro(caminho, "campo obrigatório ausente")
        elif chave in o:
            c.alerta(caminho, "valor nulo; omita o campo em vez de enviar null")
        return None
    v = o[chave]
    if not isinstance(v, str):
        c.erro(caminho, f"deve ser texto (entre aspas), veio {tipo_json(v)}: {v!r}")
        return None
    if v.strip() == "":
        if obrig:
            c.erro(caminho, "campo obrigatório está vazio")
        else:
            c.alerta(caminho, "texto vazio; omita o campo")
        return None
    if regex and not re.fullmatch(regex, v):
        c.erro(caminho, f"{descricao or 'formato inválido'} (veio {v!r})")
        return None
    return v


def le_enum(c, o, base, chave, opcoes, obrig=False, descricao=None):
    v = le_texto(c, o, base, chave, obrig)
    if v is None:
        return None
    if v not in opcoes:
        c.erro(junta(base, chave), f"valor {v!r} inválido{(' para ' + descricao) if descricao else ''}; aceitos: {', '.join(sorted(opcoes))}")
        return None
    return v


def le_data(c, o, base, chave, obrig=False):
    v = le_texto(c, o, base, chave, obrig, r"\d{4}-\d{2}-\d{2}", "data deve estar no formato AAAA-MM-DD")
    if v is None:
        return None
    try:
        return datetime.date(int(v[:4]), int(v[5:7]), int(v[8:10]))
    except ValueError:
        c.erro(junta(base, chave), f"data inexistente: {v!r}")
        return None


def le_digitos(c, o, base, chave, tam, obrig=False, nome=None):
    return le_texto(c, o, base, chave, obrig, rf"\d{{{tam}}}",
                    f"{nome or chave} deve ter exatamente {tam} dígitos, sem pontos, traços ou letras")


NUM_RE = re.compile(r"-?\d+([.,]\d+)?")


def le_num(c, o, base, chave, obrig=False, dinheiro=True, minimo_zero=True):
    """Lê Numero (number ou texto '1234.56' / '1234,56'). Devolve Decimal ou None."""
    caminho = junta(base, chave)
    if chave not in o or o[chave] is None:
        if obrig:
            c.erro(caminho, "campo obrigatório ausente")
        elif chave in o:
            c.alerta(caminho, "valor nulo; omita o campo em vez de enviar null")
        return None
    v = o[chave]
    d = None
    if isinstance(v, bool):
        pass
    elif isinstance(v, (int, float)):
        try:
            d = Decimal(repr(v))
        except InvalidOperation:
            d = None
        if d is not None and not d.is_finite():
            d = None
    elif isinstance(v, str):
        s = v.strip()
        if NUM_RE.fullmatch(s):
            d = Decimal(s.replace(",", "."))
        elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+,\d+", s):
            c.erro(caminho, f"número com separador de milhar ({v!r}); envie sem ponto de milhar, ex.: '1234,56' ou 1234.56")
            return None
    if d is None:
        c.erro(caminho, f"número inválido: {v!r}")
        return None
    if minimo_zero and d < 0:
        c.erro(caminho, f"valor negativo não é aceito: {v!r}")
        return None
    if dinheiro and d.as_tuple().exponent < -2:
        c.alerta(caminho, f"valor com mais de 2 casas decimais ({v!r}); o editor pode arredondar")
    return d


def arred(d):
    return d.quantize(CENT, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------
# Blocos comuns
# --------------------------------------------------------------------------
def valida_participante(c, o, base, obrig=True):
    p = exige_objeto(c, o, base, "participante", obrig, None)
    if p is None:
        return None
    caminho = junta(base, "participante")
    checa_chaves(c, p, caminho, "participante")
    le_texto(c, p, caminho, "nome", obrig=True)
    doc = le_texto(c, p, caminho, "cnpjCpf", regex=r"\d{11}|\d{14}",
                   descricao="cnpjCpf deve ter 14 (CNPJ) ou 11 (CPF) dígitos, só números")
    if doc is None:
        pais = p.get("codPais")
        if "cnpjCpf" not in p and (pais is None or pais == "1058"):
            c.alerta(junta(caminho, "cnpjCpf"), "participante sem CNPJ/CPF (aceitável só para exterior, com codPais diferente de 1058)")
    else:
        ok = cnpj_valido(doc) if len(doc) == 14 else cpf_valido(doc)
        if not ok:
            c.alerta(junta(caminho, "cnpjCpf"), f"{'CNPJ' if len(doc) == 14 else 'CPF'} {doc} com dígito verificador inválido")
    le_digitos(c, p, caminho, "codMunicipio", 7, nome="código do município (IBGE)")
    le_digitos(c, p, caminho, "codPais", 4, nome="código do país")
    for k in ("ie", "endereco", "numero", "complemento", "bairro", "suframa"):
        le_texto(c, p, caminho, k)
    return p


def casas(d):
    """Número de casas decimais de um Decimal, ignorando zeros à direita (1.6500 -> 2)."""
    return max(0, -d.normalize().as_tuple().exponent)


def valida_tributo(c, o, base, chave, max_casas=None):
    """PIS/COFINS. Devolve dict com cst e Decimals (ou None).
    max_casas: limite de casas decimais da alíquota (serviço: 2; imobilizado: 4)."""
    t = exige_objeto(c, o, base, chave, True, "tributo")
    if t is None:
        return None
    caminho = junta(base, chave)
    cst = le_texto(c, t, caminho, "cst", obrig=True, regex=r"\d{2}", descricao="CST deve ter 2 dígitos")
    if cst is not None and cst not in CST_PIS_COFINS:
        c.erro(junta(caminho, "cst"), f"CST {cst} não existe na tabela de PIS/COFINS (01-09, 49, 50-56, 60-67, 70-75, 98, 99)")
        cst = None
    b = le_num(c, t, caminho, "base")
    a = le_num(c, t, caminho, "aliquota", dinheiro=False)
    v = le_num(c, t, caminho, "valor")
    if a is not None:
        if a > 100:
            c.erro(junta(caminho, "aliquota"), f"alíquota {a} maior que 100; informe em percentual (1.65 = 1,65%)")
        elif 0 < a < Decimal("0.1"):
            c.alerta(junta(caminho, "aliquota"), f"alíquota {a} parece estar em fração; o contrato pede percentual (1.65 = 1,65%)")
        if max_casas is not None and casas(a) > max_casas:
            c.erro(junta(caminho, "aliquota"), f"alíquota {a} com {casas(a)} casas decimais; este tipo de documento aceita no máximo {max_casas} (ex.: 1.65 e 7.6)")
    confere_tributo(c, caminho, "PIS" if chave == "pis" else "COFINS", b, a, v)
    return {"cst": cst, "base": b, "aliquota": a, "valor": v}


def cst_exige_aliquota(cst):
    """CST de crédito (50 a 66) ou de receita tributada (01/02): o editor não supõe alíquota."""
    return cst in ("01", "02") or cst in CST_CREDITO_SERVICO


def alerta_sem_aliquota(c, caminho, t):
    """Alerta quando falta alíquota onde o CST exige (o editor não supõe; entra zerado e pendente)."""
    if t and t["cst"] and cst_exige_aliquota(t["cst"]) and t["aliquota"] is None:
        c.alerta(caminho, f"CST {t['cst']} sem alíquota: o editor não supõe alíquota; o tributo entra com valor zero, fica pendente e a validação do editor acusa erro")


def confere_tributo(c, caminho, nome, b, a, v):
    if b is not None and a is not None and v is not None:
        esperado = b * a / 100
        if abs(v - esperado) > TOL:
            c.erro(caminho, f"valor do {nome} ({arred(v)}) não bate com base × alíquota ({arred(b)} × {a}% = {arred(esperado)})")


def valida_icms_ipi(c, it, base, chave, conjunto, nome):
    o = exige_objeto(c, it, base, chave, False, conjunto)
    if o is None:
        return
    caminho = junta(base, chave)
    cst = le_texto(c, o, caminho, "cst")
    if cst is not None and not re.fullmatch(r"\d{2,3}", cst):
        c.alerta(junta(caminho, "cst"), f"CST do {nome} {cst!r} deveria ter 2 ou 3 dígitos")
    b = le_num(c, o, caminho, "base")
    a = le_num(c, o, caminho, "aliquota", dinheiro=False)
    v = le_num(c, o, caminho, "valor")
    if a is not None and a > 100:
        c.erro(junta(caminho, "aliquota"), f"alíquota do {nome} {a} maior que 100")
    confere_tributo(c, caminho, nome, b, a, v)
    if chave == "icms":
        le_num(c, o, caminho, "baseSt")
        le_num(c, o, caminho, "aliquotaSt", dinheiro=False)
        le_num(c, o, caminho, "valorSt")


def valida_item(c, it, base, operacao):
    """Devolve (valorItem, desconto) como Decimal (ou None)."""
    if not isinstance(it, dict):
        c.erro(base, f"cada item deve ser um objeto, veio {tipo_json(it)}")
        return None, None
    checa_chaves(c, it, base, "item")
    le_texto(c, it, base, "codigo", obrig=True)
    le_texto(c, it, base, "descricao", obrig=True)
    le_digitos(c, it, base, "ncm", 8, nome="NCM")
    le_texto(c, it, base, "unidade", obrig=True)
    le_enum(c, it, base, "tipoItem", TIPO_ITEM, descricao="tipo do item")
    q = le_num(c, it, base, "quantidade", obrig=True, dinheiro=False)
    if q is not None and q == 0:
        c.alerta(junta(base, "quantidade"), "quantidade zero")
    vi = le_num(c, it, base, "valorItem", obrig=True)
    vd = le_num(c, it, base, "valorDesconto")
    if vi is not None and vd is not None and vd > vi:
        c.alerta(junta(base, "valorDesconto"), f"desconto ({arred(vd)}) maior que o valor do item ({arred(vi)})")
    cfop = le_digitos(c, it, base, "cfop", 4, obrig=True, nome="CFOP")
    if cfop is not None:
        d = cfop[0]
        if d not in "123567":
            c.erro(junta(base, "cfop"), f"CFOP {cfop} não é de entrada (1/2/3) nem de saída (5/6/7)")
        elif operacao == "entrada" and d in "567":
            c.erro(junta(base, "cfop"), f"CFOP {cfop} é de saída, mas o documento é de entrada")
        elif operacao == "saida" and d in "123":
            c.erro(junta(base, "cfop"), f"CFOP {cfop} é de entrada, mas o documento é de saída")
    nat = exige_objeto(c, it, base, "natOperacao", False, "natOperacao")
    if nat is not None:
        le_texto(c, nat, junta(base, "natOperacao"), "codigo", obrig=True)
        le_texto(c, nat, junta(base, "natOperacao"), "descricao")
    valida_icms_ipi(c, it, base, "icms", "icms_item", "ICMS")
    valida_icms_ipi(c, it, base, "ipi", "ipi_item", "IPI")
    pis = valida_tributo(c, it, base, "pis")
    cof = valida_tributo(c, it, base, "cofins")
    for t, nome in ((pis, "pis"), (cof, "cofins")):
        if not t or t["cst"] is None:
            continue
        cst = t["cst"]
        if operacao == "saida" and cst not in CST_SAIDA:
            c.alerta(junta(base, nome + ".cst"), f"CST {cst} é de entrada/crédito, mas a nota é de saída")
        elif operacao == "entrada" and cst not in CST_ENTRADA:
            c.alerta(junta(base, nome + ".cst"), f"CST {cst} é de saída, mas a nota é de entrada")
        alerta_sem_aliquota(c, junta(base, nome), t)
        if cst in ("04", "05", "06", "07", "08", "09") and t["valor"] not in (None, Decimal(0)):
            c.alerta(junta(base, nome), f"CST {cst} (sem incidência) com valor de tributo diferente de zero")
    le_texto(c, it, base, "contaContabil")
    return vi, vd


def valida_credito(c, cr, base, valor_doc_ref=None):
    if not isinstance(cr, dict):
        c.erro(base, f"cada crédito deve ser um objeto, veio {tipo_json(cr)}")
        return None
    checa_chaves(c, cr, base, "credito")
    vi = le_num(c, cr, base, "valorItem", obrig=True)
    cst = le_texto(c, cr, base, "cst", obrig=True, regex=r"\d{2}", descricao="CST deve ter 2 dígitos")
    if cst is not None:
        if cst not in CST_PIS_COFINS:
            c.erro(junta(base, "cst"), f"CST {cst} não existe na tabela de PIS/COFINS")
        elif cst not in CST_ENTRADA_CREDITO and cst not in ("98", "99"):
            c.alerta(junta(base, "cst"), f"CST {cst} não é de crédito (esperado 50-56, 60-66); confira")
    le_enum(c, cr, base, "natBcCred", NAT_BC_CRED, obrig=True, descricao="código da base do crédito (01 a 18)")
    b = le_num(c, cr, base, "base")
    ap = le_num(c, cr, base, "aliquotaPis", dinheiro=False)
    ac = le_num(c, cr, base, "aliquotaCofins", dinheiro=False)
    for a, n in ((ap, "aliquotaPis"), (ac, "aliquotaCofins")):
        if a is not None:
            if a > 100:
                c.erro(junta(base, n), f"alíquota {a} maior que 100; informe em percentual")
            elif 0 < a < Decimal("0.1"):
                c.alerta(junta(base, n), f"alíquota {a} parece estar em fração; informe em percentual (1.65 = 1,65%)")
    for a, n in ((ap, "aliquotaPis"), (ac, "aliquotaCofins")):
        if a is None:
            c.alerta(base, f"crédito sem {n}: o editor não supõe alíquota; o tributo entra com valor zero, fica pendente e a validação do editor acusa erro")
    if b is not None and vi is not None and b > vi:
        c.alerta(junta(base, "base"), f"base ({arred(b)}) maior que o valor do item ({arred(vi)})")
    le_texto(c, cr, base, "contaContabil")
    return vi


def valida_creditos(c, o, base, valor_doc):
    lista = o.get("creditos")
    if "creditos" not in o or lista is None:
        c.erro("creditos", "campo obrigatório ausente (use lista vazia [] só se realmente não houver crédito)")
        return
    if not isinstance(lista, list):
        c.erro("creditos", f"deve ser uma lista, veio {tipo_json(lista)}")
        return
    if not lista:
        c.alerta("creditos", "lista de créditos vazia: o documento será escriturado sem crédito")
    soma = Decimal(0)
    for i, cr in enumerate(lista):
        vi = valida_credito(c, cr, f"creditos[{i}]")
        if vi is not None:
            soma += vi
    if valor_doc is not None and soma > valor_doc + TOL:
        c.alerta("creditos", f"soma dos créditos ({arred(soma)}) maior que o valor do documento ({arred(valor_doc)})")


def valida_chave(c, o, base, modelo, operacao_emissao, cnpj_empresa, participante, data_doc):
    """Chave com 44 dígitos e DV; compara modelo, mês e emitente."""
    ch = le_texto(c, o, base, "chave", regex=r"\d{44}",
                  descricao="chave de acesso deve ter 44 dígitos, só números (sem espaços)")
    if ch is None:
        return None
    if not chave_dv_valido(ch):
        c.erro(junta(base, "chave"), f"chave de acesso {ch} com dígito verificador inválido (módulo 11)")
        return ch
    if modelo and ch[20:22] != modelo:
        c.alerta(junta(base, "chave"), f"o modelo dentro da chave ({ch[20:22]}) é diferente do modelo informado ({modelo})")
    if data_doc and ch[2:6] != f"{data_doc.year % 100:02d}{data_doc.month:02d}":
        c.alerta(junta(base, "chave"), f"o mês/ano dentro da chave ({ch[4:6]}/20{ch[2:4]}) difere da data do documento ({data_doc.isoformat()})")
    emitente = None
    if operacao_emissao == "propria":
        emitente = cnpj_empresa
    elif operacao_emissao == "terceiros" and isinstance(participante, dict):
        emitente = participante.get("cnpjCpf")
    if emitente and re.fullmatch(r"\d{14}", emitente) and ch[6:20] != emitente:
        c.alerta(junta(base, "chave"), f"o CNPJ do emitente dentro da chave ({ch[6:20]}) não é o esperado para emissão {operacao_emissao} ({emitente})")
    return ch


def valida_periodo(c, o):
    return le_texto(c, o, "", "periodo", regex=r"\d{4}-(0[1-9]|1[0-2])",
                    descricao="período deve estar no formato AAAA-MM")


# --------------------------------------------------------------------------
# Tipos de documento
# --------------------------------------------------------------------------
def valida_nota(c, d, cnpj_empresa, est):
    operacao = le_enum(c, d, "", "operacao", {"entrada", "saida"}, obrig=True)
    emissao = le_enum(c, d, "", "emissao", {"propria", "terceiros"}, obrig=True)
    modelo = le_texto(c, d, "", "modelo", regex=r"\d{2}", descricao="modelo deve ter 2 dígitos")
    sit = le_enum(c, d, "", "situacao", SITUACAO, descricao="situação do documento")
    le_texto(c, d, "", "serie")
    le_texto(c, d, "", "numero", obrig=True)
    ddoc = le_data(c, d, "", "dataDocumento", obrig=True)
    des = le_data(c, d, "", "dataEntradaSaida")
    if ddoc and des and des < ddoc and operacao == "entrada":
        c.alerta("dataEntradaSaida", "data de entrada anterior à data de emissão")
    part = valida_participante(c, d, "")
    le_enum(c, d, "", "indPagamento", {"0", "1", "9"}, descricao="forma de pagamento")
    le_enum(c, d, "", "indFrete", IND_FRT, descricao="tipo de frete")
    valida_chave(c, d, "", modelo or "55", emissao, cnpj_empresa, part, ddoc)

    tot = exige_objeto(c, d, "", "totais", False, "totais")
    t = {}
    if tot is not None:
        for k in CAMPOS["totais"]:
            t[k] = le_num(c, tot, "totais", k)

    itens = d.get("itens")
    soma_vi, soma_vd = Decimal(0), Decimal(0)
    if "itens" not in d or itens is None:
        c.erro("itens", "campo obrigatório ausente")
    elif not isinstance(itens, list):
        c.erro("itens", f"deve ser uma lista, veio {tipo_json(itens)}")
    else:
        if not itens and sit in (None, "00", "01", "06", "07", "08"):
            c.alerta("itens", "nota sem itens")
        for i, it in enumerate(itens):
            vi, vd = valida_item(c, it, f"itens[{i}]", operacao)
            soma_vi += vi or 0
            soma_vd += vd or 0
        est["itens"] += len(itens)
        est["soma_itens"] = soma_vi - soma_vd
        if t.get("mercadorias") is not None and abs(soma_vi - t["mercadorias"]) > TOL:
            c.erro("totais.mercadorias", f"soma dos itens ({arred(soma_vi)}) diferente de totais.mercadorias ({arred(t['mercadorias'])})")
        if t.get("desconto") is not None and abs(soma_vd - t["desconto"]) > TOL:
            c.alerta("totais.desconto", f"soma dos descontos dos itens ({arred(soma_vd)}) diferente de totais.desconto ({arred(t['desconto'])})")
        if t.get("documento") is not None:
            merc = t["mercadorias"] if t.get("mercadorias") is not None else soma_vi
            esperado = (merc - (t.get("desconto") if t.get("desconto") is not None else soma_vd)
                        + (t.get("frete") or 0) + (t.get("seguro") or 0) + (t.get("outrasDespesas") or 0))
            if abs(esperado - t["documento"]) > TOL:
                c.alerta("totais.documento", f"total do documento ({arred(t['documento'])}) difere de mercadorias − desconto + frete + seguro + outras ({arred(esperado)}); confira se há IPI/ST somados")
    est["valor"] = t["documento"] if t.get("documento") is not None else soma_vi - soma_vd
    est["data"] = des or ddoc


def valida_itens_em_nota(c, d, est):
    if "periodo" not in d:
        c.alerta("periodo", "documento do tipo itens sem periodo: se houver duas notas com o mesmo número em meses diferentes, o editor recusa por ambiguidade; informe o periodo (AAAA-MM)")
    ref = exige_objeto(c, d, "", "nota", True, "nota_ref")
    if ref is not None:
        ch = le_texto(c, ref, "nota", "chave", regex=r"\d{44}",
                      descricao="chave de acesso deve ter 44 dígitos, só números")
        if ch and not chave_dv_valido(ch):
            c.erro("nota.chave", f"chave de acesso {ch} com dígito verificador inválido (módulo 11)")
        num = le_texto(c, ref, "nota", "numero")
        le_texto(c, ref, "nota", "serie")
        cp = le_texto(c, ref, "nota", "cnpjCpfParticipante", regex=r"\d{11}|\d{14}",
                      descricao="cnpjCpfParticipante deve ter 11 ou 14 dígitos")
        if not ch and not (num and cp):
            c.erro("nota", "informe a chave da nota OU número + série + cnpjCpfParticipante para localizá-la")
    itens = d.get("itens")
    soma = Decimal(0)
    if "itens" not in d or itens is None:
        c.erro("itens", "campo obrigatório ausente")
    elif not isinstance(itens, list):
        c.erro("itens", f"deve ser uma lista, veio {tipo_json(itens)}")
    else:
        if not itens:
            c.alerta("itens", "lista de itens vazia")
        for i, it in enumerate(itens):
            vi, vd = valida_item(c, it, f"itens[{i}]", None)
            soma += (vi or 0) - (vd or 0)
        est["itens"] += len(itens)
    est["valor"] = soma
    est["data"] = None


def valida_frete(c, d, cnpj_empresa, est):
    operacao = le_enum(c, d, "", "operacao", {"entrada", "saida"}, obrig=True)
    emissao = le_enum(c, d, "", "emissao", {"propria", "terceiros"}, obrig=True)
    modelo = le_texto(c, d, "", "modelo", regex=r"\d{2}", descricao="modelo deve ter 2 dígitos")
    le_enum(c, d, "", "situacao", SITUACAO, descricao="situação do documento")
    le_texto(c, d, "", "serie")
    le_texto(c, d, "", "subserie")
    le_texto(c, d, "", "numero", obrig=True)
    ddoc = le_data(c, d, "", "dataDocumento", obrig=True)
    des = le_data(c, d, "", "dataEntradaSaida")
    part = valida_participante(c, d, "")
    vdoc = le_num(c, d, "", "valorDocumento", obrig=True)
    le_num(c, d, "", "valorDesconto")
    le_enum(c, d, "", "indFrete", IND_FRT, descricao="tipo de frete")
    le_num(c, d, "", "valorServico")
    ic = exige_objeto(c, d, "", "icms", False, "icms_frete")
    if ic is not None:
        for k in CAMPOS["icms_frete"]:
            le_num(c, ic, "icms", k)
    le_enum(c, d, "", "natFrete", IND_NAT_FRT, obrig=True, descricao="natureza do frete (IND_NAT_FRT)")
    le_texto(c, d, "", "contaContabil")
    valida_chave(c, d, "", modelo or "57", emissao, cnpj_empresa, part, ddoc)
    valida_creditos(c, d, "", vdoc)
    est["valor"] = vdoc or Decimal(0)
    est["data"] = des or ddoc
    _ = operacao


def valida_energia(c, d, cnpj_empresa, est):
    modelo = le_enum(c, d, "", "modelo", MODELOS_ENERGIA, descricao="modelo (06, 28, 29, 55 ou 66)")
    le_enum(c, d, "", "situacao", SITUACAO, descricao="situação do documento")
    le_texto(c, d, "", "serie")
    le_texto(c, d, "", "subserie")
    le_texto(c, d, "", "numero", obrig=True)
    ddoc = le_data(c, d, "", "dataDocumento", obrig=True)
    dent = le_data(c, d, "", "dataEntrada", obrig=True)
    if ddoc and dent and dent < ddoc:
        c.alerta("dataEntrada", "data de entrada anterior à data de emissão")
    part = valida_participante(c, d, "")
    vdoc = le_num(c, d, "", "valorDocumento", obrig=True)
    le_num(c, d, "", "valorIcms")
    valida_chave(c, d, "", modelo or "06", "terceiros", cnpj_empresa, part, ddoc)
    valida_creditos(c, d, "", vdoc)
    est["valor"] = vdoc or Decimal(0)
    est["data"] = dent or ddoc


def valida_f100(c, d, est):
    ind = le_enum(c, d, "", "indOper", {"0", "1", "2"}, obrig=True, descricao="indicador de operação")
    valida_participante(c, d, "", obrig=False)
    le_texto(c, d, "", "codItem")
    data = le_data(c, d, "", "data", obrig=True)
    valor = le_num(c, d, "", "valor", obrig=True)
    pis = valida_tributo(c, d, "", "pis")
    cof = valida_tributo(c, d, "", "cofins")
    nb = le_enum(c, d, "", "natBcCred", NAT_BC_CRED, descricao="código da base do crédito (01 a 18)")
    if ind == "0" and nb is None and "natBcCred" not in d:
        c.erro("natBcCred", "obrigatório quando indOper = \"0\" (entrada com direito a crédito)")
    if ind in ("1", "2") and nb is not None:
        c.alerta("natBcCred", "natBcCred só faz sentido para indOper = \"0\"; será ignorado")
    le_enum(c, d, "", "indOrigCred", {"0", "1"}, descricao="origem do crédito")
    le_texto(c, d, "", "contaContabil")
    le_texto(c, d, "", "centroCusto")
    le_texto(c, d, "", "descricao")
    for t, n in ((pis, "pis"), (cof, "cofins")):
        alerta_sem_aliquota(c, n, t)
        if t and t["cst"]:
            if ind == "0" and t["cst"] not in CST_ENTRADA:
                c.alerta(f"{n}.cst", f"CST {t['cst']} não é de entrada/crédito, mas indOper = \"0\"")
            if ind in ("1", "2") and t["cst"] not in CST_SAIDA:
                c.alerta(f"{n}.cst", f"CST {t['cst']} não é de receita, mas indOper = \"{ind}\"")
    est["valor"] = valor or Decimal(0)
    est["data"] = data


def valida_servico(c, d, est, periodo):
    operacao = le_enum(c, d, "", "operacao", {"contratado", "prestado"}, obrig=True)
    le_enum(c, d, "", "emissao", {"propria", "terceiros"}, obrig=True)
    sit = le_enum(c, d, "", "situacao", {"00", "02"}, descricao="situação do serviço (00 regular ou 02 cancelado)")
    for k in ("serie", "subserie"):
        v = le_texto(c, d, "", k)
        if v is not None and len(v) > 20:
            c.erro(k, f"{k} com {len(v)} caracteres; o máximo é 20")
    num = le_texto(c, d, "", "numero", obrig=True)
    if num is not None and len(num) > 60:
        c.erro("numero", f"número com {len(num)} caracteres; o máximo é 60 (use \"SN\" se não houver número)")
    ch = le_texto(c, d, "", "chave")
    if ch is not None and len(ch) > 60:
        c.erro("chave", f"chave/código de verificação com {len(ch)} caracteres; o máximo é 60")
    ddoc = le_data(c, d, "", "dataDocumento", obrig=True)
    dexe = le_data(c, d, "", "dataExecucao")
    if periodo and (ddoc or dexe):
        if not any(x and x.strftime("%Y-%m") == periodo for x in (ddoc, dexe)):
            c.alerta("periodo", f"nem a data de emissão nem a de execução estão em {periodo}; confira o mês da escrituração")

    # participante: obrigatório no serviço contratado
    if operacao == "contratado" and d.get("participante") is None:
        c.erro("participante", "obrigatório no serviço contratado (é o prestador do serviço; sem ele o A100 não tem fornecedor)")
    else:
        valida_participante(c, d, "", obrig=False)

    le_enum(c, d, "", "indPagamento", {"0", "1", "9"}, descricao="forma de pagamento")
    vdoc = le_num(c, d, "", "valorDocumento")
    vdesc = le_num(c, d, "", "valorDesconto")
    pret = le_num(c, d, "", "pisRetido")
    cret = le_num(c, d, "", "cofinsRetido")
    le_num(c, d, "", "valorIss")

    itens = d.get("itens")
    soma_vi, soma_vd = Decimal(0), Decimal(0)
    if itens is None:
        if sit != "02":
            c.erro("itens", "campo obrigatório ausente (só nota cancelada, situacao \"02\", pode ficar sem itens)")
    elif not isinstance(itens, list):
        c.erro("itens", f"deve ser uma lista, veio {tipo_json(itens)}")
    else:
        if sit == "02" and itens:
            c.alerta("itens", "nota cancelada (situacao \"02\") com itens; os itens não deveriam ser informados")
        if not itens and sit != "02":
            c.alerta("itens", "nota de serviço sem itens")
        for i, it in enumerate(itens):
            vi, vd = valida_item_servico(c, it, f"itens[{i}]", operacao)
            soma_vi += vi or 0
            soma_vd += vd or 0
        est["itens"] += len(itens)
        if itens and vdoc is not None:
            esperado = soma_vi - (vdesc if vdesc is not None else soma_vd)
            if abs(esperado - vdoc) > TOL:
                c.alerta("valorDocumento", f"valor do documento ({arred(vdoc)}) difere de soma dos itens − desconto ({arred(esperado)}); confira")
        if itens and vdesc is not None and abs(soma_vd - vdesc) > TOL:
            c.alerta("valorDesconto", f"desconto do documento ({arred(vdesc)}) difere da soma dos descontos dos itens ({arred(soma_vd)})")
    ref_valor = vdoc if vdoc is not None else (soma_vi - (vdesc if vdesc is not None else soma_vd))
    for v, n in ((pret, "pisRetido"), (cret, "cofinsRetido")):
        if v is not None and ref_valor is not None and v > ref_valor + TOL:
            c.alerta(n, f"valor retido ({arred(v)}) maior que o valor do documento ({arred(ref_valor)})")
    est["valor"] = ref_valor if sit != "02" else Decimal(0)
    est["data"] = dexe or ddoc


def valida_item_servico(c, it, base, operacao):
    """Devolve (valorItem, desconto) como Decimal (ou None)."""
    if not isinstance(it, dict):
        c.erro(base, f"cada item deve ser um objeto, veio {tipo_json(it)}")
        return None, None
    checa_chaves(c, it, base, "item_servico")
    cod = le_texto(c, it, base, "codigo", obrig=True)
    if cod is not None and len(cod) > 60:
        c.erro(junta(base, "codigo"), f"código do serviço com {len(cod)} caracteres; o máximo é 60")
    le_texto(c, it, base, "descricao", obrig=True)
    cs = le_texto(c, it, base, "codigoServico")
    if cs is not None and not re.fullmatch(r"(0[1-9]|[1-3]\d|40)\.\d{2}", cs):
        c.alerta(junta(base, "codigoServico"), f"código de serviço {cs!r} fora do padrão da LC 116/2003 (NN.NN, ex.: 17.01; itens 01 a 40)")
    un = le_texto(c, it, base, "unidade")
    if un is not None and len(un) > 6:
        c.erro(junta(base, "unidade"), f"unidade com {len(un)} caracteres ({un!r}); o máximo é 6")
    le_texto(c, it, base, "descricaoComplementar")
    vi = le_num(c, it, base, "valorItem", obrig=True)
    vd = le_num(c, it, base, "valorDesconto")
    if vi is not None and vd is not None and vd > vi:
        c.alerta(junta(base, "valorDesconto"), f"desconto ({arred(vd)}) maior que o valor do item ({arred(vi)})")
    nb = le_enum(c, it, base, "natBcCred", NAT_BC_CRED, descricao="código da base do crédito (01 a 18)")
    le_enum(c, it, base, "indOrigCred", {"0", "1"}, descricao="origem do crédito")
    pis = valida_tributo(c, it, base, "pis", max_casas=2)
    cof = valida_tributo(c, it, base, "cofins", max_casas=2)
    le_texto(c, it, base, "contaContabil")
    le_texto(c, it, base, "centroCusto")

    liquido = (vi - (vd or 0)) if vi is not None else None
    tem_credito = False
    for t, nome in ((pis, "pis"), (cof, "cofins")):
        if not t or t["cst"] is None:
            continue
        cst, cam = t["cst"], junta(base, nome)
        if operacao == "contratado":
            if cst in CST_CREDITO_SERVICO:
                tem_credito = True
            elif cst in CST_SAIDA:
                c.alerta(junta(cam, "cst"), f"CST {cst} é de receita, mas o serviço é contratado (esperado 50 a 66 com crédito ou 70 a 99 sem crédito)")
            elif cst == "67":
                c.alerta(junta(cam, "cst"), "CST 67 está fora do intervalo de crédito do serviço (50 a 66); confira")
        elif operacao == "prestado":
            if cst not in CST_SAIDA:
                c.alerta(junta(cam, "cst"), f"CST {cst} é de entrada/crédito, mas o serviço é prestado (esperado 01 a 09, 49 ou 99)")
        alerta_sem_aliquota(c, cam, t)
        if t["base"] is not None and liquido is not None and t["base"] > liquido + TOL:
            c.alerta(junta(cam, "base"), f"base ({arred(t['base'])}) maior que valor do item − desconto ({arred(liquido)})")
        if t["base"] is None and t["aliquota"] is not None and t["valor"] is not None and liquido is not None:
            esperado = liquido * t["aliquota"] / 100
            if abs(t["valor"] - esperado) > TOL:
                c.alerta(cam, f"valor ({arred(t['valor'])}) não bate com (valor do item − desconto) × alíquota ({arred(esperado)})")
    if tem_credito and nb is None:
        c.erro(junta(base, "natBcCred"), "obrigatório quando o CST é de crédito (50 a 66): informe o código da base do crédito (ex.: \"03\" serviços utilizados como insumo)")
    if operacao == "prestado":
        for k in ("natBcCred", "indOrigCred"):
            if it.get(k) is not None:
                c.erro(junta(base, k), f"{k} não vale em serviço prestado (o editor recusa; A170 campos 07 e 08 são só do serviço contratado): omita")
    else:
        if nb is not None and not tem_credito:
            c.alerta(junta(base, "natBcCred"), "natBcCred só vale com CST de crédito (50 a 66); será ignorado")
        if it.get("indOrigCred") is not None and not tem_credito:
            c.alerta(junta(base, "indOrigCred"), "indOrigCred só faz sentido em serviço contratado com crédito")
    if it.get("indOrigCred") == "1" and operacao != "prestado":
        c.alerta(junta(base, "indOrigCred"), "origem \"1\" (importação): o guia exige o registro A120, que a importação não cria")
    return vi, vd


def valida_imobilizado(c, d, est, periodo):
    if periodo is None and "periodo" not in d:
        c.erro("periodo", "obrigatório no imobilizado (o bem não tem data de documento; informe o mês, ex.: \"2025-03\")")
    modal = le_enum(c, d, "", "modalidade", {"depreciacao", "aquisicao"}, obrig=True,
                    descricao="modalidade (depreciacao = F120; aquisicao = F130)")
    le_enum(c, d, "", "identificacaoBem", IDENT_BEM, obrig=True, descricao="identificação do bem (IDENT_BEM_IMOB)")
    le_enum(c, d, "", "indOrigCred", {"0", "1"}, descricao="origem do crédito")
    util = le_enum(c, d, "", "utilizacao", UTIL_BEM, obrig=True, descricao="utilização do bem (IND_UTIL_BEM_IMOB)")
    venc = le_num(c, d, "", "valorEncargo")
    maq = le_texto(c, d, "", "mesAquisicao", regex=r"\d{4}-(0[1-9]|1[0-2])", descricao="mesAquisicao deve estar no formato AAAA-MM")
    vaq = le_num(c, d, "", "valorAquisicao")
    psc = le_num(c, d, "", "parcelaSemCredito")
    parc = le_enum(c, d, "", "parcelas", {"1", "2", "3", "4", "5", "9"}, descricao="número de parcelas (IND_NR_PARC)")
    bmes = le_num(c, d, "", "baseMes")
    pis = valida_tributo(c, d, "", "pis", max_casas=4)
    cof = valida_tributo(c, d, "", "cofins", max_casas=4)
    le_texto(c, d, "", "contaContabil")
    le_texto(c, d, "", "centroCusto")
    le_texto(c, d, "", "descricao")

    nb = le_enum(c, d, "", "natBcCred", NAT_BC_CRED, descricao="código da base do crédito (01 a 18)")
    valor_ref = Decimal(0)
    base_esperada = None
    if modal == "depreciacao":
        if nb is not None and nb not in NAT_BC_F120:
            c.erro("natBcCred", f"natBcCred {nb} não vale no F120 (depreciação/amortização): use \"09\" depreciação ou \"11\" amortização (\"10\" é do F130, aquisição)")
        if venc is None and d.get("valorEncargo") is None:
            c.erro("valorEncargo", "obrigatório na depreciação (F120): encargo de depreciação/amortização do mês")
        for k in ("mesAquisicao", "valorAquisicao", "parcelas", "baseMes"):
            if d.get(k) is not None:
                c.alerta(k, f"{k} é do F130 (aquisição); será ignorado na depreciação")
        if venc is not None:
            valor_ref = venc
            if psc is not None and psc > venc + TOL:
                c.erro("parcelaSemCredito", f"parcela sem crédito ({arred(psc)}) maior que o encargo ({arred(venc)}): a base ficaria negativa")
            else:
                base_esperada = venc - (psc or 0)
    elif modal == "aquisicao":
        if nb is not None and nb not in NAT_BC_F130:
            c.erro("natBcCred", f"natBcCred {nb} não vale no F130 (aquisição): só \"10\" (pode omitir); \"09\" e \"11\" são do F120")
        if vaq is None and d.get("valorAquisicao") is None:
            c.erro("valorAquisicao", "obrigatório na aquisição (F130): valor de aquisição do bem")
        if d.get("parcelas") is None:
            c.erro("parcelas", "obrigatório na aquisição (F130): nº de parcelas do crédito (\"1\" integral, \"2\" 12 meses, \"3\" 24, \"4\" 48, \"5\" 6 meses, \"9\" outra)")
        if d.get("valorEncargo") is not None:
            c.alerta("valorEncargo", "valorEncargo é do F120 (depreciação); será ignorado na aquisição")
        if parc == "9":
            if bmes is None and d.get("baseMes") is None:
                c.erro("baseMes", "obrigatório quando parcelas = \"9\" (outra periodicidade): informe a base de cálculo do mês")
        elif d.get("baseMes") is not None:
            c.alerta("baseMes", "baseMes só vale quando parcelas = \"9\"; será ignorado")
        if maq is not None and periodo and maq > periodo:
            c.alerta("mesAquisicao", f"mês de aquisição ({maq}) posterior ao mês da escrituração ({periodo})")
        if vaq is not None:
            valor_ref = vaq
            if psc is not None and psc > vaq + TOL:
                c.erro("parcelaSemCredito", f"parcela sem crédito ({arred(psc)}) maior que o valor de aquisição ({arred(vaq)}): a base ficaria negativa")
            elif parc == "9":
                base_esperada = bmes
            elif parc in MESES_PARCELAS:
                base_esperada = (vaq - (psc or 0)) / MESES_PARCELAS[parc]
    # utilização × CST
    for t, nome in ((pis, "pis"), (cof, "cofins")):
        if not t or t["cst"] is None:
            continue
        cst = t["cst"]
        if cst in CST_SAIDA:
            c.alerta(f"{nome}.cst", f"CST {cst} é de receita; o bem do imobilizado usa CST de crédito (50 a 66) ou sem crédito (70 a 99)")
        elif cst in CST_CREDITO_SERVICO and util == "9":
            c.alerta(f"{nome}.cst", f"CST {cst} é de crédito, mas a utilização do bem é \"9\" (outros, sem direito a crédito)")
        alerta_sem_aliquota(c, nome, t)
        if base_esperada is not None:
            if t["base"] is not None and abs(t["base"] - base_esperada) > TOL:
                c.alerta(f"{nome}.base", f"base informada ({arred(t['base'])}) difere da regra do guia ({arred(base_esperada)}); o editor ignora a base informada e usa a da regra (omita a base)")
            if t["base"] is None and t["aliquota"] is not None and t["valor"] is not None:
                esperado = base_esperada * t["aliquota"] / 100
                if abs(t["valor"] - esperado) > TOL:
                    c.alerta(nome, f"valor ({arred(t['valor'])}) não bate com base pela regra do guia × alíquota ({arred(esperado)})")
    est["valor"] = valor_ref
    est["data"] = None
    est["sub"] = modal


# --------------------------------------------------------------------------
# Pacote inteiro
# --------------------------------------------------------------------------
def valida_pacote(dados):
    c = Ctx()
    est = {
        "por_tipo": Counter(), "por_mes": defaultdict(Counter), "itens": 0,
        "valor_tipo": defaultdict(Decimal), "total_docs": 0, "sub": Counter(),
    }
    if not isinstance(dados, dict):
        c.erro("", f"o arquivo deve conter um objeto JSON, veio {tipo_json(dados)}")
        return c, est
    checa_chaves(c, dados, "", "topo")
    if dados.get("formato") != "sped-contrib-import":
        c.erro("formato", f"deve ser exatamente \"sped-contrib-import\" (veio {dados.get('formato')!r})")
    v = dados.get("versao")
    if isinstance(v, bool) or not isinstance(v, int) or v != 1:
        c.erro("versao", f"deve ser o número 1 (veio {v!r})")
    cnpj = le_texto(c, dados, "", "cnpj", obrig=True, regex=r"\d{14}",
                    descricao="cnpj do estabelecimento deve ter 14 dígitos, só números")
    if cnpj and not cnpj_valido(cnpj):
        c.alerta("cnpj", f"CNPJ {cnpj} com dígito verificador inválido")
    le_texto(c, dados, "", "origem")

    docs = dados.get("documentos")
    if "documentos" not in dados or docs is None:
        c.erro("documentos", "campo obrigatório ausente")
        return c, est
    if not isinstance(docs, list):
        c.erro("documentos", f"deve ser uma lista, veio {tipo_json(docs)}")
        return c, est
    if not docs:
        c.alerta("documentos", "pacote sem nenhum documento")

    vistos_chave = {}
    vistos_num = {}
    for i, d in enumerate(docs):
        n = i + 1
        ref = d.get("referencia") if isinstance(d, dict) and isinstance(d.get("referencia"), str) else None
        tipo = d.get("tipo") if isinstance(d, dict) else None
        c.doc = (n, tipo if isinstance(tipo, str) else "?", ref)
        if not isinstance(d, dict):
            c.erro("", f"cada documento deve ser um objeto, veio {tipo_json(d)}")
            continue
        if tipo not in TIPOS_DOC:
            c.erro("tipo", f"tipo {tipo!r} inválido; aceitos: {', '.join(TIPOS_DOC)}")
            continue
        checa_chaves(c, d, "", tipo)
        periodo = valida_periodo(c, d)
        le_texto(c, d, "", "referencia")
        e = {"itens": 0, "valor": Decimal(0), "data": None, "sub": None}
        if tipo == "nota":
            valida_nota(c, d, cnpj, e)
        elif tipo == "itens":
            valida_itens_em_nota(c, d, e)
        elif tipo == "frete":
            valida_frete(c, d, cnpj, e)
        elif tipo == "energia":
            valida_energia(c, d, cnpj, e)
        elif tipo == "servico":
            valida_servico(c, d, e, periodo)
        elif tipo == "imobilizado":
            valida_imobilizado(c, d, e, periodo)
        else:
            valida_f100(c, d, e)

        # duplicidades
        ch = d.get("chave") if isinstance(d.get("chave"), str) else None
        if tipo != "itens":
            if ch and re.fullmatch(r"\d{44}", ch):
                if ch in vistos_chave:
                    c.alerta("chave", f"chave repetida: já aparece no documento {vistos_chave[ch]}")
                else:
                    vistos_chave[ch] = n
            elif tipo in ("nota", "frete", "energia", "servico"):
                p = d.get("participante") if isinstance(d.get("participante"), dict) else {}
                k = (tipo, d.get("modelo"), d.get("operacao"), d.get("serie"), d.get("numero"), p.get("cnpjCpf"))
                if k in vistos_num:
                    c.alerta("numero", f"mesmo número/série/participante já aparece no documento {vistos_num[k]}")
                else:
                    vistos_num[k] = n

        mes = periodo or (e["data"].strftime("%Y-%m") if e["data"] else "sem período")
        est["por_tipo"][tipo] += 1
        est["por_mes"][mes][tipo] += 1
        est["itens"] += e["itens"]
        est["valor_tipo"][tipo] += e["valor"]
        if e.get("sub"):
            est["sub"][e["sub"]] += 1
    c.doc = None
    est["total_docs"] = len(docs)
    if est["itens"] > LIMITE_ITENS:
        c.alerta("documentos", f"pacote com {est['itens']} itens (acima de ~{LIMITE_ITENS}); divida em mais de um pacote")
    return c, est


# --------------------------------------------------------------------------
# Saída
# --------------------------------------------------------------------------
def fmt_valor(d):
    s = f"{arred(d):,.2f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def imprime_lista(titulo, itens, maximo):
    for k, (doc, caminho, msg) in enumerate(itens):
        if maximo and k >= maximo:
            print(f"   ... mais {len(itens) - maximo} {titulo.lower()}(s) omitido(s); use --max 0 para ver todos")
            break
        if doc:
            idx, tipo, ref = doc
            cab = f"{titulo}  Documento {idx} ({tipo}; posição {idx} na lista \"documentos\", índice {idx - 1} no JSON)" + (f" - {caminho}" if caminho else "")
        else:
            cab = f"{titulo}  Pacote" + (f" - {caminho}" if caminho else "")
        print(cab)
        print(f"       {msg}")
        if doc and doc[2]:
            print(f"       Referência: {doc[2]}")


def imprime_resumo(est):
    print("\nRESUMO")
    print(f"  Documentos: {est['total_docs']}   Itens (notas, serviços e itens avulsos): {est['itens']}")
    rotulos = {"nota": "Notas de mercadoria", "itens": "Itens avulsos em nota existente", "frete": "Fretes (CT-e)",
               "energia": "Energia/água/gás", "f100": "Operações sem nota (F100)",
               "servico": "Notas de serviço (A100/A170)", "imobilizado": "Bens do imobilizado (F120/F130)"}
    for t in TIPOS_DOC:
        if est["por_tipo"][t]:
            extra = ""
            if t == "imobilizado":
                extra = f" [{est['sub']['depreciacao']} depreciação/F120, {est['sub']['aquisicao']} aquisição/F130]"
            rot_valor = "encargos + aquisições, antes da parcela sem crédito" if t == "imobilizado" else "valor somado"
            print(f"  - {rotulos[t]}: {est['por_tipo'][t]}{extra}  ({rot_valor}: R$ {fmt_valor(est['valor_tipo'][t])})")
    if est["por_mes"]:
        print("  Por mês:")
        for mes in sorted(est["por_mes"]):
            partes = ", ".join(f"{est['por_mes'][mes][t]} {t}" for t in TIPOS_DOC if est["por_mes"][mes][t])
            print(f"    {mes}: {partes}")


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    args = [a for a in argv[1:] if not a.startswith("--")]
    maximo = 100
    if "--max" in argv:
        try:
            maximo = int(argv[argv.index("--max") + 1])
            args = [a for a in args if a != str(maximo)]
        except (IndexError, ValueError):
            print("Uso: python3 validar_pacote.py pacote.json [--max N]")
            return 2
    if len(args) != 1:
        print("Uso: python3 validar_pacote.py pacote.json [--max N]")
        return 2
    try:
        with open(args[0], encoding="utf-8-sig") as f:
            dados = json.load(f)
    except FileNotFoundError:
        print(f"ERRO  Arquivo não encontrado: {args[0]}")
        return 2
    except json.JSONDecodeError as ex:
        print(f"ERRO  O arquivo não é um JSON válido: {ex.msg} (linha {ex.lineno}, coluna {ex.colno})")
        return 1
    except UnicodeDecodeError:
        print("ERRO  O arquivo precisa estar salvo em UTF-8.")
        return 1

    c, est = valida_pacote(dados)
    print(f"Validação de {args[0]}\n")
    if c.erros:
        imprime_lista("ERRO  ", c.erros, maximo)
        print()
    if c.alertas:
        imprime_lista("ALERTA", c.alertas, maximo)
        print()
    imprime_resumo(est)
    print()
    if c.erros:
        print(f"RESULTADO: REPROVADO - {len(c.erros)} erro(s), {len(c.alertas)} alerta(s). Corrija os erros antes de entregar o pacote.")
        return 1
    print(f"RESULTADO: APROVADO - 0 erros, {len(c.alertas)} alerta(s)." + (" Leia os alertas antes de entregar." if c.alertas else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
