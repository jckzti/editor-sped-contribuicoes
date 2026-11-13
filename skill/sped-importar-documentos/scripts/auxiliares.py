"""Conversões prontas para montar o pacote de importação (somente biblioteca padrão).

Uso dentro de um script de conversão:

    import sys; sys.path.insert(0, "<pasta desta skill>/scripts")
    from auxiliares import numero_br, data_iso, so_digitos, dinheiro, chave_limpa

Todas as funções levantam ValueError quando não têm certeza. Isso é proposital:
é melhor deixar a linha de fora e relatar do que chutar um valor.
"""
import datetime
import re
from decimal import ROUND_HALF_UP, Decimal


def numero_br(txt, ponto_decimal=False):
    """Converte '1.234,56', 'R$ 1.234,56', '1234.56', '(10,00)' em Decimal.

    Um único ponto com 3 casas depois ('1.234') é ambíguo (milhar ou decimal?).
    Nesse caso levanta ValueError, a menos que se diga ponto_decimal=True
    (planilha que já usa ponto como decimal) ou se use '1.234,00'.
    """
    if isinstance(txt, (int, float, Decimal)) and not isinstance(txt, bool):
        return Decimal(str(txt))
    s = str(txt).strip().replace("R$", "").replace(" ", "").replace(" ", "")
    if s == "":
        raise ValueError("valor vazio")
    negativo = s.startswith("(") and s.endswith(")") or s.startswith("-") or s.endswith("-")
    s = s.strip("()-")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")      # 1.234,56
        else:
            s = s.replace(",", "")                         # 1,234.56
    elif "," in s:
        if s.count(",") > 1:
            s = s.replace(",", "")
        else:
            s = s.replace(",", ".")                        # 1234,56
    elif "." in s:
        if s.count(".") > 1:
            s = s.replace(".", "")                         # 1.234.567
        elif re.fullmatch(r"\d{1,3}\.\d{3}", s) and not ponto_decimal:
            raise ValueError(f"ambíguo: {txt!r} pode ser 1234 (milhar) ou 1,234 (decimal)")
    if not re.fullmatch(r"\d+(\.\d+)?", s):
        raise ValueError(f"não é número: {txt!r}")
    d = Decimal(s)
    return -d if negativo else d


def dinheiro(valor):
    """Arredonda para 2 casas e devolve texto '1234.56' (aceito pelo pacote)."""
    return str(Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def data_iso(txt):
    """Converte 'dd/mm/aaaa', 'dd-mm-aaaa', 'dd.mm.aaaa', 'aaaa-mm-dd' (e datetime) em 'AAAA-MM-DD'."""
    if isinstance(txt, datetime.datetime):
        return txt.date().isoformat()
    if isinstance(txt, datetime.date):
        return txt.isoformat()
    s = str(txt).strip()[:10]
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        a, mes, d = map(int, m.groups())
    else:
        m = re.fullmatch(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", s)
        if not m:
            raise ValueError(f"data não reconhecida: {txt!r} (se for número de série do Excel, converta antes)")
        d, mes, a = map(int, m.groups())
    return datetime.date(a, mes, d).isoformat()  # ValueError se a data não existir


def so_digitos(txt, tamanho=None, zeros_a_esquerda=False):
    """Tira máscara de CNPJ/CPF/NCM/CFOP. Com tamanho, exige esse número de dígitos
    (completa com zeros à esquerda só se zeros_a_esquerda=True, útil para CNPJ/CPF
    que o Excel transformou em número)."""
    s = re.sub(r"\D", "", str(txt))
    if tamanho:
        if zeros_a_esquerda and 0 < len(s) < tamanho:
            s = s.zfill(tamanho)
        if len(s) != tamanho:
            raise ValueError(f"esperados {tamanho} dígitos, veio {len(s)}: {txt!r}")
    return s


def chave_limpa(txt):
    """Chave de acesso: tira espaços, pontos e prefixo 'NFe'. Exige 44 dígitos."""
    return so_digitos(re.sub(r"^\s*(NFe|CTe)", "", str(txt), flags=re.I), 44)
