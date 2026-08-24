import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const version = '1.0.23';
const installUrl = 'https://ysraestudos.github.io/Acompanhamento/sin-inline.user.js';
const metaUrl = 'https://ysraestudos.github.io/Acompanhamento/sin-inline.meta.js';
const downloadUrl = `https://ysraestudos.github.io/Acompanhamento/releases/${version}/sin-inline.user.js`;

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'KM Acompanhamento',
        namespace: 'http://tampermonkey.net/',
        version,
        updateURL: metaUrl,
        downloadURL: downloadUrl,
        description: 'Exibe o KM Acompanhamento inline e agiliza o preenchimento UNSPSC no Klassmatt.',
        author: 'Ysrael Xavier',
        match: [
          'https://*.klassmatt.com.br/*SIN_Item_Edita.aspx*',
          'https://*.klassmatt.com.br/*ITEM_Edita.aspx*',
          'https://klassmatt.com.br/*SIN_Item_Edita.aspx*',
          'https://klassmatt.com.br/*ITEM_Edita.aspx*'
        ],
        'run-at': 'document-end',
        grant: ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_xmlhttpRequest', 'unsafeWindow'],
        connect: ['*.klassmatt.com.br', 'klassmatt.com.br']
      },
      build: {
        fileName: 'sin-inline.user.js'
      }
    })
  ]
});
