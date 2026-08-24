// ==UserScript==
// @name         KM Acompanhamento
// @namespace    http://tampermonkey.net/
// @version      1.0.23
// @author       Ysrael Xavier
// @description  Exibe o KM Acompanhamento inline e agiliza o preenchimento UNSPSC no Klassmatt.
// @downloadURL  https://ysraestudos.github.io/Acompanhamento/releases/1.0.23/sin-inline.user.js
// @updateURL    https://ysraestudos.github.io/Acompanhamento/sin-inline.meta.js
// @match        https://*.klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        https://*.klassmatt.com.br/*ITEM_Edita.aspx*
// @match        https://klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        https://klassmatt.com.br/*ITEM_Edita.aspx*
// @connect      *.klassmatt.com.br
// @connect      klassmatt.com.br
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==
