const SUPPORTED_ITEM_PATHS = [
  /\/SIN_Item_Edita\.aspx$/i,
  /\/ITEM_Edita\.aspx$/i
];

const CONTEXT_HINT_SELECTOR = '#UpdatePanel1, .kl-view, #DV_Resumo_sin, #hlkObs, #hButAcompanhamentoSIN';

export function isSupportedItemPath(pathname: string): boolean {
  return SUPPORTED_ITEM_PATHS.some((pattern) => pattern.test(String(pathname || '')));
}

export function shouldBootstrapSinSidebar(
  pathname: string = window.location.pathname,
  doc: ParentNode = document,
  protocol: string = window.location.protocol
): boolean {
  if (String(protocol || '').toLowerCase() !== 'https:') return false;
  if (!isSupportedItemPath(pathname)) return false;
  return Boolean(doc.querySelector(CONTEXT_HINT_SELECTOR));
}
