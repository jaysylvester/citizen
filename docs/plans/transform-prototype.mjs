// SafeString marks framework-trusted HTML (e.g. include output)
class SafeString { constructor(v){ this.value = v } toString(){ return this.value } }
const $ctznEscape = (v) => {
  if (v === null || v === undefined) return v          // preserve "null"/"undefined" coercion
  if (v instanceof SafeString) return v                // trusted, raw
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// --- the compiler ---------------------------------------------------------
// transformBody: content of a template literal (the view file, or a nested `...`)
// transformExpr: JS expression text inside ${...}; may contain nested template literals
function transformBody(s) {
  let out = '', i = 0
  while (i < s.length) {
    if (s[i] === '$' && s[i+1] === '{') {
      const raw = s[i+2] === '{'                 // ${{  -> raw bypass
      const openLen = raw ? 3 : 2
      const [expr, end] = readInterp(s, i + openLen, raw)
      const t = transformExpr(expr)
      out += raw ? '${' + t + '}' : '${$ctznEscape(' + t + ')}'
      i = end
    } else {
      out += s[i++]
    }
  }
  return out
}
// read from j until the matching close; raw needs }} , escaped needs }
function readInterp(s, j, raw) {
  let depth = 1, start = j
  while (j < s.length) {
    const c = s[j]
    if (c === "'" || c === '"') { j = skipString(s, j, c); continue }
    if (c === '`') { j = skipTemplate(s, j); continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        return raw ? [s.slice(start, j), j + 2] : [s.slice(start, j), j + 1]
      }
    }
    j++
  }
  throw new Error('unterminated interpolation')
}
function skipString(s, j, q) {
  j++
  while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j] === q) return j + 1; else j++ }
  throw new Error('unterminated string')
}
function skipTemplate(s, j) { // returns index just after the closing backtick
  j++
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue }
    if (s[j] === '`') return j + 1
    if (s[j] === '$' && s[j+1] === '{') {         // skip nested ${...}
      let d = 1; j += 2
      while (j < s.length && d > 0) {
        if (s[j] === "'" || s[j] === '"') { j = skipString(s, j, s[j]); continue }
        if (s[j] === '`') { j = skipTemplate(s, j); continue }
        if (s[j] === '{') d++; else if (s[j] === '}') d--
        j++
      }
      continue
    }
    j++
  }
  throw new Error('unterminated template')
}
// transformExpr: find nested template literals in the expression, transform their bodies
function transformExpr(e) {
  let out = '', i = 0
  while (i < e.length) {
    const c = e[i]
    if (c === "'" || c === '"') { const k = skipString(e, i, c); out += e.slice(i, k); i = k; continue }
    if (c === '`') {
      const k = skipTemplate(e, i)               // whole nested template literal text
      const body = e.slice(i + 1, k - 1)
      out += '`' + transformBody(body) + '`'
      i = k; continue
    }
    out += c; i++
  }
  return out
}

// --- render helper matching how server.js would call it -------------------
function render(view, ctx) {
  const compiled = transformBody(view)
  const fn = new Function('$ctznEscape, SafeString, local, url, include',
    'return `' + compiled + '`')
  return { compiled, html: fn($ctznEscape, SafeString, ctx.local, ctx.url, ctx.include) }
}

const ctx = {
  local: {
    title: '<b>Hi & bye</b>',
    html: '<em>trusted</em>',
    items: ['<i>a</i>', 'b & c'],
    missing: undefined,
    n: null
  },
  url: { page: '1"><script>alert(1)</script>' },
  include: { _head: new SafeString('<head><title>ok</title></head>') }
}

const cases = [
  '<h1>${local.title}</h1>',
  '<p>${{local.html}}</p>',
  'head=${include._head}',
  'page ${url.page}',
  '<ul>${{ local.items.map(x => `<li>${x}</li>`).join(``) }}</ul>',
  'brace ${ local.title + `}` }',
  'missing=[${local.missing}] null=[${local.n}]'
]
for (const v of cases) {
  const r = render(v, ctx)
  console.log('VIEW :', v)
  console.log('COMP :', r.compiled)
  console.log('HTML :', r.html)
  console.log()
}
