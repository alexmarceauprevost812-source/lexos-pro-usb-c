/* LexOS · Couleurs du code (coloration syntaxique maison, sans dépendance) */
"use strict";

const LANGS = {
  py: "python", python: "python", js: "js", mjs: "js", cjs: "js", javascript: "js", ts: "js", tsx: "js", jsx: "js", typescript: "js",
  json: "json", html: "html", htm: "html", xml: "html", svg: "html", vue: "html", css: "css", scss: "css",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash", console: "bash", terminal: "bash",
  md: "md", markdown: "md", txt: "texte", text: "texte",
};
const MOTS = {
  python: "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case",
  js: "await|async|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|interface|type|enum|implements",
  bash: "if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|export|local|sudo|cd|echo|exit|source",
};
const SPECIAUX = {
  python: "True|False|None|self|cls|print|len|range|open|str|int|float|list|dict|set|tuple|isinstance|super|enumerate|zip|map|filter|sorted|input|type|Exception",
  js: "true|false|null|undefined|NaN|Infinity|console|document|window|JSON|Math|Promise|Array|Object|String|Number|Map|Set|fetch|require|module",
};

function _regles(lang) {
  const k = (s) => new RegExp(`\\b(?:${s})\\b`);
  switch (lang) {
    case "python": return [
      ["com", /#[^\n]*/], ["chaine", /(?:[rRbBfFuU]{0,2})(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/],
      ["deco", /@[\w.]+/], ["mot", k(MOTS.python)], ["special", k(SPECIAUX.python)],
      ["nombre", /\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?j?)\b/], ["fonction", /\b[A-Za-z_]\w*(?=\s*\()/], ["classe", /\b[A-Z][A-Za-z0-9_]+\b/]];
    case "js": return [
      ["com", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/], ["chaine", /`(?:\\.|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/],
      ["mot", k(MOTS.js)], ["special", k(SPECIAUX.js)], ["nombre", /\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b/],
      ["fonction", /\b[A-Za-z_$][\w$]*(?=\s*\()/], ["classe", /\b[A-Z][A-Za-z0-9_$]+\b/], ["op", /=>|===|!==|&&|\|\||\?\?/]];
    case "json": return [["cle", /"(?:\\.|[^"\\])*"(?=\s*:)/], ["chaine", /"(?:\\.|[^"\\])*"?/], ["special", /\b(?:true|false|null)\b/], ["nombre", /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/]];
    case "html": return [
      ["com", /<!--[\s\S]*?(?:-->|$)/], ["balise", /<\/?[A-Za-z][\w:-]*|\/?>/], ["attr", /\b[\w:-]+(?==)/], ["chaine", /"[^"]*"?|'[^']*'?/], ["entite", /&[#\w]+;/]];
    case "css": return [
      ["com", /\/\*[\s\S]*?(?:\*\/|$)/], ["chaine", /"[^"\n]*"?|'[^'\n]*'?/], ["couleur", /#[\da-fA-F]{3,8}\b/],
      ["attr", /[\w-]+(?=\s*:)/], ["nombre", /-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/], ["balise", /[.#]?[A-Za-z][\w-]*(?=[^{}]*\{)/], ["mot", /@[\w-]+|!important/]];
    case "bash": return [
      ["com", /#[^\n]*/], ["chaine", /"(?:\\.|[^"\\])*"?|'[^']*'?/], ["variable", /\$\{?[\w@#?*]+\}?/],
      ["mot", k(MOTS.bash)], ["fonction", /(?:^|(?<=[|;&]\s*))[\w./-]+/m], ["option", /\s--?[\w-]+/]];
    case "md": return [["titre", /^#{1,6} [^\n]*/m], ["chaine", /`[^`\n]+`/], ["mot", /\*\*[^*\n]+\*\*/], ["attr", /\[[^\]\n]+\]\([^)\n]+\)/], ["special", /^\s*(?:[-*+]|\d+\.)\s/m]];
    default: return [];
  }
}
const _cache = {};
function _regex(lang) {
  if (_cache[lang]) return _cache[lang];
  const r = _regles(lang);
  return (_cache[lang] = r.length ? { classes: r.map((x) => x[0]), re: new RegExp(r.map((x) => `(${x[1].source})`).join("|"), "gm") } : null);
}
const _esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/* Retourne le HTML coloré (déjà échappé) */
function colorier(code, langue) {
  const lang = LANGS[(langue || "").toLowerCase()] || (langue || "").toLowerCase();
  const R = code.length < 300000 && _regex(lang);
  if (!R) return _esc(code);
  let out = "", dernier = 0;
  R.re.lastIndex = 0;
  for (let m; (m = R.re.exec(code));) {
    if (!m[0]) { R.re.lastIndex++; continue; }
    const i = m.slice(1).findIndex((g) => g !== undefined);
    out += _esc(code.slice(dernier, m.index)) + `<span class="tk-${R.classes[i]}">${_esc(m[0])}</span>`;
    dernier = m.index + m[0].length;
  }
  return out + _esc(code.slice(dernier));
}
const langueDe = (chemin) => (chemin || "").split(".").pop().toLowerCase();
