/**
 * Importar documentos que não estão no arquivo: pelo JSON do pacote de importação
 * (arrastado ou colado) ou por XML de NF-e.
 *
 * Nada entra sem passar pela validação (`validarPacote`), mostrada documento a
 * documento. No XML de NF-e de entrada emitida por terceiros, o PIS/COFINS da
 * compra NÃO está no arquivo: o documento entra com CST 98 (pendente) e precisa de
 * uma regra para definir o crédito — a tela avisa isso bem visível.
 */
import { useMemo, useState } from 'react';
import { importarPacote, validarPacote, type ResultadoImportacaoDetalhado } from '../core/importar';
import { simular } from '../core/operacao';
import type { DocumentoImport, PacoteImportacao } from '../core/importacao.tipos';
import type { Escrituracao } from '../core/modelo';
import { xmlNfeParaNota, type FinalidadeCompra } from '../core/xmlNfe';
import { Dialogo } from './Dialogo';
import { cnpjLegivel, inteiro, periodoLegivel } from './formato';

export interface ImportarDocumentosProps {
  escrituracoes: Escrituracao[];
  aoFechar: () => void;
  aoImportar: () => void;
}

interface Carga {
  pacote: PacoteImportacao;
  /** De onde veio, para a tela mostrar. */
  origem: string;
  /** Pendências vindas da conversão de XML. */
  pendenciasXml: string[];
}

export function ImportarDocumentos({ escrituracoes, aoFechar, aoImportar }: ImportarDocumentosProps) {
  const cnpjs = useMemo(() => [...new Set(escrituracoes.map((e) => e.cnpj))], [escrituracoes]);
  const [cnpj, setCnpj] = useState(cnpjs[0] ?? '');
  const [texto, setTexto] = useState('');
  const [carga, setCarga] = useState<Carga | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoDetalhado | null>(null);
  /** Para converter o CFOP de venda do fornecedor em CFOP de entrada (insumo × revenda). */
  const [finalidade, setFinalidade] = useState<FinalidadeCompra | ''>('');

  const validacao = useMemo(() => (carga ? validarPacote(carga.pacote) : null), [carga]);

  /**
   * Ensaio da importação (feita e desfeita na hora, sem histórico): diz ANTES de
   * importar quantos documentos entram e por que os outros ficariam de fora (CNPJ de
   * outra empresa, mês não carregado, documento repetido...).
   */
  const ensaio = useMemo(() => {
    if (!carga || !validacao || validacao.gerais.length || !carga.pacote.documentos?.length) return null;
    try {
      return simular(() => importarPacote(escrituracoes, carga.pacote));
    } catch {
      return null;
    }
  }, [carga, validacao, escrituracoes]);

  const cnpjPacote = (carga?.pacote.cnpj ?? '').replace(/\D/g, '');
  const cnpjForaDaSessao = !!ensaio && ensaio.incluidos === 0 && ensaio.ignorados.some((ig) => /Nenhuma escrituração carregada tem o estabelecimento/.test(ig.motivo));

  const lerJson = (conteudo: string, origem: string) => {
    try {
      const dados = JSON.parse(conteudo) as PacoteImportacao;
      setCarga({ pacote: dados, origem, pendenciasXml: [] });
      setErro(null);
      setResultado(null);
    } catch {
      setErro('O conteúdo não é um JSON válido. Cole o pacote de importação inteiro, começando por "{".');
    }
  };

  const lerXmls = async (arquivos: File[]) => {
    if (!cnpj) {
      setErro('Carregue pelo menos uma escrituração antes de importar XML (é preciso saber o CNPJ da empresa).');
      return;
    }
    const documentos: DocumentoImport[] = [];
    const pendencias: string[] = [];
    const falhas: string[] = [];
    for (const f of arquivos) {
      try {
        const nota = xmlNfeParaNota(await f.text(), cnpj, finalidade ? { finalidade } : {});
        for (const p of nota.pendencias) if (!pendencias.includes(p)) pendencias.push(p);
        documentos.push(nota);
      } catch (err) {
        falhas.push(`${f.name}: ${(err as Error)?.message ?? String(err)}`);
      }
    }
    setErro(falhas.length ? falhas.join(' | ') : null);
    if (documentos.length) {
      setCarga({
        pacote: { formato: 'sped-contrib-import', versao: 1, cnpj, origem: `${documentos.length} XML de NF-e`, documentos },
        origem: `${documentos.length} XML de NF-e`,
        pendenciasXml: pendencias,
      });
      setResultado(null);
    }
  };

  const receber = (lista: FileList | null) => {
    if (!lista?.length) return;
    const arquivos = [...lista];
    const xmls = arquivos.filter((f) => /\.xml$/i.test(f.name));
    const jsons = arquivos.filter((f) => /\.json$/i.test(f.name));
    if (xmls.length) void lerXmls(xmls);
    else if (jsons.length) void jsons[0].text().then((t) => lerJson(t, jsons[0].name));
    else setErro('Arraste o JSON do pacote de importação ou arquivos .xml de NF-e.');
  };

  const confirmar = () => {
    if (!carga) return;
    try {
      const r = importarPacote(escrituracoes, carga.pacote);
      setResultado(r);
      aoImportar();
    } catch (err) {
      setErro((err as Error)?.message ?? String(err));
    }
  };

  const podeImportar =
    !!validacao && !validacao.gerais.length && validacao.porDocumento.size === 0 && !!carga?.pacote.documentos?.length && (!ensaio || ensaio.incluidos > 0);

  return (
    <Dialogo
      titulo="Importar documentos"
      subtitulo="Pacote de importação (JSON) ou XML de NF-e. Os documentos vão para o mês de cada data."
      aoFechar={aoFechar}
      tamanho="largo"
      rodape={
        resultado ? (
          <>
            <span className="espaco" />
            <button className="primario" onClick={aoFechar}>
              Fechar
            </button>
          </>
        ) : (
          <>
            <button className="primario" onClick={confirmar} disabled={!podeImportar}>
              {ensaio && ensaio.incluidos === 0
                ? 'Nada a importar'
                : `Importar ${carga ? `${inteiro(ensaio?.incluidos ?? carga.pacote.documentos?.length ?? 0)} documento(s)` : ''}`}
            </button>
            <span className="espaco" />
            <button onClick={aoFechar}>Cancelar</button>
          </>
        )
      }
    >
      {!resultado && (
        <>
          {cnpjs.length > 1 && (
            <div className="campo">
              <label htmlFor="cnpj-import">CNPJ da empresa (para o XML)</label>
              <select id="cnpj-import" value={cnpj} onChange={(e) => setCnpj(e.target.value)}>
                {cnpjs.map((c) => (
                  <option key={c} value={c}>
                    {cnpjLegivel(c)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="campo">
            <label htmlFor="finalidade-xml">Compras em XML de NF-e: finalidade (para o CFOP de entrada)</label>
            <select id="finalidade-xml" value={finalidade} onChange={(e) => setFinalidade(e.target.value as FinalidadeCompra | '')}>
              <option value="">não informar: o CFOP fica pendente quando a venda do fornecedor não define (1949/2949)</option>
              <option value="insumo">insumo (industrialização ou prestação de serviço)</option>
              <option value="revenda">revenda (comercialização)</option>
            </select>
            <span className="fraco">Vale para os XML escolhidos a seguir. O PIS/COFINS da entrada continua pendente (CST 98) até uma regra definir o crédito.</span>
          </div>

          <div
            className={`carregar compacto${sobre ? ' sobre' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setSobre(true);
            }}
            onDragLeave={() => setSobre(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(false);
              receber(e.dataTransfer.files);
            }}
          >
            <p>Arraste aqui o JSON do pacote de importação ou os arquivos .xml de NF-e</p>
            <label className="oculto" htmlFor="arq-import">
              Arquivos para importar
            </label>
            <input id="arq-import" type="file" multiple accept=".json,.xml" onChange={(e) => receber(e.target.files)} />
          </div>

          <div className="campo largura-total">
            <label htmlFor="json-colado">…ou cole o JSON aqui</label>
            <textarea
              id="json-colado"
              rows={5}
              value={texto}
              placeholder='{"formato":"sped-contrib-import","versao":1,"cnpj":"...","documentos":[...]}'
              onChange={(e) => setTexto(e.target.value)}
            />
            <button onClick={() => lerJson(texto, 'texto colado')} disabled={!texto.trim()}>
              Conferir o JSON colado
            </button>
          </div>

          {erro && <div className="aviso erro">{erro}</div>}

          {carga && carga.pendenciasXml.length > 0 && (
            <div className="aviso alerta">
              <strong>Atenção: a tributação da entrada entra pendente.</strong>
              <ul className="lista-erros">
                {carga.pendenciasXml.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              O XML da NF-e do fornecedor traz o PIS/COFINS <em>dele</em>, não o seu crédito. Os itens entram com CST 98, base e alíquota zeradas: crie uma
              regra (aba Regras) para definir o CST de crédito, as alíquotas e a base nesses itens.
            </div>
          )}

          {validacao && (
            <>
              <h4>Conferência do pacote ({carga?.origem})</h4>
              {validacao.gerais.length > 0 && (
                <div className="aviso erro">
                  <ul className="lista-erros">
                    {validacao.gerais.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              {validacao.porDocumento.size > 0 ? (
                <div className="aviso erro">
                  <strong>{validacao.porDocumento.size} documento(s) com problema:</strong>
                  <div className="tabela-rolagem baixa">
                    <table className="tabela compacta">
                      <thead>
                        <tr>
                          <th>Documento</th>
                          <th>O que corrigir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...validacao.porDocumento.entries()].map(([i, erros]) => (
                          <tr key={i}>
                            <td>
                              nº {i + 1}
                              {carga?.pacote.documentos?.[i]?.referencia ? ` (${carga.pacote.documentos[i].referencia})` : ''}
                            </td>
                            <td>{erros.join(' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                !validacao.gerais.length &&
                (cnpjForaDaSessao ? (
                  <div className="aviso erro forte">
                    <strong>Nenhum documento vai entrar: o pacote é de outra empresa.</strong> O pacote é do CNPJ {cnpjLegivel(cnpjPacote)}, e os meses carregados
                    são de {cnpjs.map(cnpjLegivel).join(', ')}. Os documentos só entram na escrituração do mesmo CNPJ (estabelecimento) e do mesmo mês. Confira
                    se o pacote foi gerado para o cliente certo, ou carregue a escrituração dessa empresa.
                  </div>
                ) : ensaio && ensaio.ignorados.length > 0 ? (
                  <div className={`aviso ${ensaio.incluidos ? 'alerta' : 'erro forte'}`}>
                    <strong>
                      {ensaio.incluidos
                        ? `${inteiro(ensaio.incluidos)} documento(s) vão entrar; ${inteiro(ensaio.ignorados.length)} ficarão de fora:`
                        : 'Nenhum documento vai entrar:'}
                    </strong>
                    <div className="tabela-rolagem baixa">
                      <table className="tabela compacta">
                        <thead>
                          <tr>
                            <th>Documento</th>
                            <th>Por que fica de fora</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ensaio.ignorados.map((ig, i) => (
                            <tr key={i}>
                              <td>
                                nº {ig.indice + 1}
                                {ig.referencia ? ` (${ig.referencia})` : ''}
                              </td>
                              <td>{ig.motivo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="aviso info">
                    {inteiro(ensaio?.incluidos ?? carga?.pacote.documentos?.length ?? 0)} documento(s) conferidos: todos vão entrar
                    {ensaio && Object.keys(ensaio.porEscrituracao).length
                      ? ` (${Object.entries(ensaio.porEscrituracao)
                          .map(([id, n]) => `${inteiro(n)} em ${periodoLegivel(escrituracoes.find((x) => x.id === id)?.periodo ?? '')}`)
                          .join(', ')})`
                      : ''}
                    . Clique em Importar.
                  </div>
                ))
              )}
            </>
          )}
        </>
      )}

      {resultado && (
        <>
          <div className="aviso info">
            <strong>{inteiro(resultado.incluidos)} documento(s) incluído(s).</strong>
            {resultado.pendentesTributacao > 0 && ` ${inteiro(resultado.pendentesTributacao)} item/crédito com tributação pendente: veja os avisos abaixo e defina por regra.`}
          </div>
          <h4>Por mês</h4>
          <table className="tabela compacta">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="num">Documentos</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(resultado.porEscrituracao).map(([id, n]) => {
                const e = escrituracoes.find((x) => x.id === id);
                return (
                  <tr key={id}>
                    <td>{e ? periodoLegivel(e.periodo) : id}</td>
                    <td className="num">{inteiro(n)}</td>
                  </tr>
                );
              })}
              {!Object.keys(resultado.porEscrituracao).length && (
                <tr>
                  <td colSpan={2} className="fraco">
                    Nenhum documento incluído.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {resultado.ignorados.length > 0 && (
            <>
              <h4>Ignorados ({inteiro(resultado.ignorados.length)})</h4>
              <div className="tabela-rolagem baixa">
                <table className="tabela compacta">
                  <thead>
                    <tr>
                      <th>Documento</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.ignorados.map((ig, i) => (
                      <tr key={i}>
                        <td>
                          nº {ig.indice + 1}
                          {ig.referencia ? ` (${ig.referencia})` : ''}
                        </td>
                        <td>{ig.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {resultado.avisos.length > 0 && (
            <>
              <h4>Avisos ({inteiro(resultado.avisos.length)})</h4>
              <div className="tabela-rolagem baixa">
                <table className="tabela compacta">
                  <tbody>
                    {resultado.avisos.map((a, i) => (
                      <tr key={i}>
                        <td>
                          {a.indice < 0 ? 'geral' : `nº ${a.indice + 1}`}
                          {a.referencia ? ` (${a.referencia})` : ''}
                        </td>
                        <td>{a.mensagem}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Dialogo>
  );
}
