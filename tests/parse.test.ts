import fs from 'node:fs';
import path from 'node:path';
import { parseHistory, scopeTimelineToItem } from '../src/parse';

const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures');

function parseFixture(name: string) {
  const html = fs.readFileSync(path.join(fixturesDir, name), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseHistory(doc);
}

describe('history parser', () => {
  it('parses strict history HTML and keeps yellow comments', () => {
    const result = parseFixture('hist-strict.html');

    expect(result.timeline).toHaveLength(2);
    expect(result.timeline[0].stage).toBe('CATALOGACAO');
    expect(result.timeline[0].yellowComments).toEqual(['USAR PDM BRINDE. ATRIBUTO USO: AQUA']);
    expect(result.timeline[0].hasAttentionHighlight).toBe(false);
    expect(result.timeline[0].descricaoHtml).not.toContain('USAR PDM BRINDE');
    expect(result.summary.totalTransicoes).toBe(1);
    expect(result.confidence).toBe('high');
    expect(result.documentIdentity?.id).toBe('209355');
    expect(result.warnings).toEqual([]);
  });

  it('falls back to the loose parser without splitting multiline changes into fake events', () => {
    const result = parseFixture('hist-loose.html');

    expect(result.timeline).toHaveLength(4);
    expect(result.timeline[0].descricao).toContain('MATERIAL CORPO de [] para [ACO]');
    expect(result.timeline[1].stage).toBe('FINALIZAÇÃO');
    expect(result.timeline[2].stage).toBe('APROVACAO-KLASSMATT');
  });

  it('marks attention highlights only for lei and NCM/NBS candidates with official prefixes', () => {
    const doc = new DOMParser().parseFromString(`
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">Validar lei e NCMabc8408.20.90xyz</span>
        </div>
        <div class="row result">
          <span id="lblHora">10:05:00</span>
          <span id="lblDescricao">Analisar NBS<br><span style="background-color: yellow">codigo NBS1.0101.00.00</span></span>
        </div>
        <div class="row result">
          <span id="lblHora">10:10:00</span>
          <span id="lblDescricao">Nao destacar NCM 00000000, NCM 20260706 nem NBS 199990000</span>
        </div>
        <div class="row result">
          <span id="lblHora">10:15:00</span>
          <span id="lblDescricao">OK (CA#20260706.1112.061134046)</span>
        </div>
      </fieldset>
    `, 'text/html');

    const result = parseHistory(doc);

    expect(result.timeline[0].hasAttentionHighlight).toBe(true);
    expect(result.timeline[0].attentionMatches).toEqual(['LEI', 'NCM', '8408.20.90']);
    expect(result.timeline[1].hasAttentionHighlight).toBe(true);
    expect(result.timeline[1].attentionMatches).toEqual(['NBS', '1.0101.00.00']);
    expect(result.timeline[2].hasAttentionHighlight).toBe(false);
    expect(result.timeline[2].attentionMatches).toEqual([]);
    expect(result.timeline[3].hasAttentionHighlight).toBe(false);
    expect(result.timeline[3].attentionMatches).toEqual([]);
  });

  it('does not mark short numbers as attention highlights', () => {
    const doc = new DOMParser().parseFromString(`
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">Revisar item 1234 e norma interna</span>
        </div>
      </fieldset>
    `, 'text/html');

    const result = parseHistory(doc);

    expect(result.timeline[0].hasAttentionHighlight).toBe(false);
    expect(result.timeline[0].attentionMatches).toEqual([]);
  });

  it('parses the real 84429 fixture and keeps only the two correct yellow comments', () => {
    const result = parseFixture('hist-real-84429.html');

    const yellowOnly = result.timeline.filter((event) => event.yellowComments.length > 0);

    expect(result.confidence).toBe('high');
    expect(result.documentIdentity?.id).toBe('84429');
    expect(result.documentIdentity?.k).toBe('75423vt11qxrtyxxcokhwmo5v3l2_1620');
    expect(yellowOnly).toHaveLength(2);
    expect(yellowOnly[0].hora).toBe('16:16:34');
    expect(yellowOnly[0].stage).toBe('CATALOGACAO');
    expect(yellowOnly[0].yellowComments).toEqual([
      'https://www.mercadolivre.com.br/kit-de-impacto-do-macaco-eletrico-hidraulico-6-em-1--12v-5t/up/MLBU3669022538'
    ]);
    expect(yellowOnly[1].hora).toBe('16:15:04');
    expect(yellowOnly[1].stage).toBe('APROVACAO-REVISAO');
    expect(yellowOnly[1].yellowComments).toEqual([
      'PREZADOS, PARA O CORRETO CADASTRO, FAVOR INFORMAR A COMPOSICAO DO CONJUNTO OU ANEXAR FICHA DE DADOS DO ITEM.'
    ]);
    expect(JSON.stringify(yellowOnly)).not.toContain('pd 20200');
    expect(JSON.stringify(yellowOnly)).not.toContain('REAVALIACAO-CATALOG');
  });

  it('ignores colored spans that are not yellow-note highlights', () => {
    const doc = new DOMParser().parseFromString(`
      <form action="./Historico.aspx?source=SIN&Id=123456&SomenteLeitura=1">
        <fieldset class="hist-fieldset">
          <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
          <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
          <div class="row result">
            <span id="lblHora">10:00:00</span>
            <span id="lblDescricao">
              Solicitacao enviada para CATALOGACAO
              <br>
              <span style="background-color: lightblue; --darkreader-inline-bgcolor: var(--darkreader-background-add8e6, #1b4958);">nao e comentario amarelo</span>
            </span>
          </div>
        </fieldset>
      </form>
    `, 'text/html');

    const result = parseHistory(doc);

    expect(result.confidence).toBe('high');
    expect(result.timeline[0].yellowComments).toEqual([]);
    expect(result.timeline[0].descricao).toContain('nao e comentario amarelo');
  });

  it('accepts a yellow-only description as a valid acompanhamento comment', () => {
    const doc = new DOMParser().parseFromString(`
      <form action="./Historico.aspx?source=SIN&Id=84405&SomenteLeitura=1">
        <fieldset class="hist-fieldset">
          <legend class="hist-legend">quinta-feira, 2 de abril de 2026</legend>
          <div class="row"><a id="hlinkUsuario">C011000518</a></div>
          <div class="row result">
            <span id="lblHora">08:24:16</span>
            <span id="lblDescricao">
              <span style="color: black; background-color: Yellow;"><strong>OK</strong></span>
            </span>
          </div>
        </fieldset>
      </form>
    `, 'text/html');

    const result = parseHistory(doc);

    expect(result.confidence).toBe('high');
    expect(result.warnings).toEqual([]);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].descricao).toBe('');
    expect(result.timeline[0].yellowComments).toEqual(['OK']);
  });

  it('filters mixed SIN history to the current item segment when multiple created items appear', () => {
    const doc = new DOMParser().parseFromString(`
      <form action="./Historico.aspx?source=SIN&Id=84405&SomenteLeitura=1">
        <fieldset class="hist-fieldset">
          <legend class="hist-legend">quinta-feira, 2 de abril de 2026</legend>
          <div class="row"><a id="hlinkUsuario">USR.TESTE</a></div>
          <div class="row result">
            <span id="lblHora">10:30:00</span>
            <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
          </div>
          <div class="row result">
            <span id="lblHora">10:25:00</span>
            <span id="lblDescricao">Criado o Item nº <a href="javascript:{OpenNewTab('ITEM_Resumo.aspx?pesquisa_sin=84405&IdItem=300892'); }"><u>300892</u></a></span>
          </div>
          <div class="row result">
            <span id="lblHora">10:20:00</span>
            <span id="lblDescricao">Solicitacao enviada para APROVACAO-REVISAO<br><span style="background-color: yellow">Comentario item 300892</span></span>
          </div>
          <div class="row result">
            <span id="lblHora">09:40:00</span>
            <span id="lblDescricao">Solicitacao enviada para FINALIZACAO</span>
          </div>
          <div class="row result">
            <span id="lblHora">09:35:00</span>
            <span id="lblDescricao">Criado o Item nº <a href="javascript:{OpenNewTab('ITEM_Resumo.aspx?pesquisa_sin=84405&IdItem=300891'); }"><u>300891</u></a></span>
          </div>
          <div class="row result">
            <span id="lblHora">09:30:00</span>
            <span id="lblDescricao">Solicitacao enviada para APROVACAO-REVISAO<br><span style="background-color: yellow">Comentario item 300891</span></span>
          </div>
        </fieldset>
      </form>
    `, 'text/html');

    const result = parseHistory(doc);
    const scoped = scopeTimelineToItem(result.timeline, '300892');

    expect(scoped.status).toBe('filtered');
    expect(scoped.summary.totalEventos).toBe(3);
    expect(scoped.summary.totalYellowEvents).toBe(1);
    expect(scoped.timeline).toHaveLength(3);
    expect(scoped.timeline.some((event) => event.descricao.includes('300891'))).toBe(false);
    expect(JSON.stringify(scoped.timeline)).toContain('Comentario item 300892');
    expect(JSON.stringify(scoped.timeline)).not.toContain('Comentario item 300891');
  });

  it('keeps single-item SIN history intact when the current item marker is present', () => {
    const result = parseFixture('hist-real-84429.html');
    const scoped = scopeTimelineToItem(result.timeline, '300891');

    expect(scoped.status).toBe('unscoped');
    expect(scoped.timeline).toHaveLength(result.timeline.length);
    expect(scoped.summary).toEqual(result.summary);
  });
});
