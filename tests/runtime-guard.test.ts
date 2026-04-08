import { isSupportedItemPath, shouldBootstrapSinSidebar } from '../src/runtime-guard';

describe('runtime guard', () => {
  it('accepts the supported Klassmatt item routes', () => {
    expect(isSupportedItemPath('/SIN_Item_Edita.aspx')).toBe(true);
    expect(isSupportedItemPath('/ITEM_Edita.aspx')).toBe(true);
    expect(isSupportedItemPath('/outra-pagina.aspx')).toBe(false);
  });

  it('requires both a supported path and item-context hints', () => {
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view">
          <div id="DV_Resumo_sin"></div>
        </div>
      </div>
    `;

    expect(shouldBootstrapSinSidebar('/SIN_Item_Edita.aspx')).toBe(true);
    expect(shouldBootstrapSinSidebar('/SIN_Item_Edita.aspx', document, 'http:')).toBe(false);
    expect(shouldBootstrapSinSidebar('/Historico.aspx')).toBe(false);

    document.body.innerHTML = '<div>sem contexto</div>';
    expect(shouldBootstrapSinSidebar('/SIN_Item_Edita.aspx')).toBe(false);
  });
});
