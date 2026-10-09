import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { compileTemplate, escapeHtml, getTemplate } from '../lib/template.js'


const value = '<b>"Hello" & \'bye\'</b>',
      escaped = '&lt;b&gt;&quot;Hello&quot; &amp; &#39;bye&#39;&lt;/b&gt;',
      render = (source, context = {}, type = 'text/html') => compileTemplate(source, '/views/test.html', type)(context)


test('HTML text and quoted attributes escape values; raw output retains markup', () => {
  assert.equal(render('<p>${local.value}</p><a title="${local.value}" data-x=\'${local.value}\'>', { local: { value } }),
    '<p>' + escaped + '</p><a title="' + escaped + '" data-x=\'' + escaped + '\'>')
  assert.equal(render('${{local.value}}', { local: { value } }), value)
  assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})


test('native coercion, evaluation order, and errors are preserved', () => {
  let events = [],
      object = { [Symbol.toPrimitive](hint) { events.push(hint); return value } },
      context = { local: { first() { events.push('first'); return object }, last() { events.push('last'); return 'end' } } }

  assert.equal(render('${local.first()}|${local.last()}', context), escaped + '|end')
  assert.deepEqual(events, ['first', 'string', 'last'])
  assert.equal(render('${null}|${undefined}|${0}|${false}'), 'null|undefined|0|false')
  assert.throws(() => render('${local.value}', { local: { value: Symbol('x') } }), TypeError)
  assert.throws(() => render('${local.value}', { local: { value: { toString() { throw new Error('coercion') } } } }), /coercion/)
  assert.equal(render('${ 1, local.value }', { local: { value } }), escaped)
})


test('ordinary expressions escape only their final results and keep intermediate data intact', () => {
  let context = { local: { value } }

  assert.equal(render('${ `${local.value}` }', context), escaped)
  assert.equal(render('${ JSON.parse(JSON.stringify({value: `${local.value}`})).value }', context), escaped)
  assert.equal(render('${ `${{local.value}}` }', context), escaped)
  assert.equal(render('${ `${{ `<b>${local.value}</b>` }}` }', context), escapeHtml('<b>' + value + '</b>'))
})


test('view scopes and native Function context are preserved', () => {
  let names = ['config', 'cookie', 'form', 'local', 'payload', 'route', 'session', 'url', 'query'],
      context = Object.fromEntries(names.map(name => [name, { value }]))

  assert.equal(render(names.map(name => '${' + name + '.value}').join('|'), context), names.map(() => escaped).join('|'))
  assert.equal(render('${arguments[0].value}|${new.target}', context), escaped + '|undefined')
  assert.equal(render('${Object.keys(include).length}'), '0')
})


test('raw markup builders escape their value boundaries through multiple nesting levels', () => {
  let context = { local: { items: [value, '&'], trusted: '<em>ok</em>', rows: [[value], ['&']] } }

  assert.equal(render('<ul>${{local.items.map(x => `<li>${x}</li>`).join(\'\')}}</ul>', context), '<ul><li>' + escaped + '</li><li>&amp;</li></ul>')
  assert.equal(render('${{local.rows.map(row => `<ul>${{row.map(x => `<li>${x}</li>`).join(\'\')}}</ul>`).join(\'\')}}', context),
    '<ul><li>' + escaped + '</li></ul><ul><li>&amp;</li></ul>')
  assert.equal(render('${{ `<div>${ `${local.items[0]}` }${{local.trusted}}</div>` }}', context), '<div>' + escaped + '<em>ok</em></div>')
  assert.equal(render('${{local.items.map(x => `<li>${x}</li>`)}}', context), '<li>' + escaped + '</li>,<li>&amp;</li>')
})


test('only direct top-level include references bypass escaping and values stay strings', () => {
  let context = { include: { piece: '<p>&amp;</p>' } },
      escapedInclude = '&lt;p&gt;&amp;amp;&lt;/p&gt;'

  assert.equal(render('${include.piece}|${include[\'piece\']}', context), '<p>&amp;</p>|<p>&amp;</p>')
  assert.equal(render('${ `${include.piece}` }|${true ? include.piece : \'\'}', context), escapedInclude + '|' + escapedInclude)
  assert.equal(render('${{ `<div>${include.piece}</div>` }}', context), '<div>' + escapedInclude + '</div>')
  assert.equal(render('${{true ? include.piece : \'\'}}|${include.piece.length}|${typeof include.piece}', context), '<p>&amp;</p>|12|string')
  assert.equal(render('${include?.piece}|${include[local.key]}', { ...context, local: { key: 'piece' } }), escapedInclude + '|' + escapedInclude)
})


test('JavaScript grammar and template escape sequences are preserved', () => {
  let context = { local: { value } }

  for ( let expression of ['/[}]/.test(\'}\') ? local.value : \'\'', '8 / 2, local.value', '/* } ` ${{ */ local.value', 'local.value // } `\n'] ) {
    assert.equal(render('${' + expression + '}', context), escaped)
  }
  assert.equal(render('\\${local.value}|\\`|\\\\|\\n'), '${local.value}|`|\\|\n')
  assert.equal(render('${ {a: 1} }|${{({a: 1}).a}}|${{{a: 1}}}'), '[object Object]|1|[object Object]')
  assert.equal(render('${"${{literal}}"}'), '${{literal}}')
  assert.equal(render('${{ /}}/.test(\'}}\') ? `<p>${local.value}</p>` : \'\' }}', context), '<p>' + escaped + '</p>')
  assert.equal(render('${{ `${"quoted \\" value"}` }}'), 'quoted &quot; value')
})


test('tagged templates are opaque and enclosing boundaries control their output', () => {
  let calls = [],
      context = { local: { value, tag(strings, ...values) { calls.push([strings.raw[0], values[0]]); return values[0] } } }

  assert.equal(render('${local.tag`\\n${`${local.value}`}`}', context), escaped)
  assert.equal(render('${{local.tag`\\n${`${local.value}`}`}}', context), value)
  assert.deepEqual(calls, [['\\n', value], ['\\n', value]])
  assert.equal(render('${local.tag`\\unicode${local.value}`}', context), escaped)
  for ( let source of ['${local.tag`${{local.value}}`}', '${local.tag`${`${{local.value}}`}`}', '${{local.tag`${{local.value}}`}}'] ) {
    assert.throws(() => render(source, context), /Raw interpolation is not allowed inside a tagged template/)
  }
})


test('tag expressions transform markup and raw markers while their quasis stay opaque', () => {
  let calls = [],
      context = { local: { value, tagFor(markup) {
        return (strings, substitution) => {
          calls.push([markup, strings.raw[0], substitution])
          return markup
        }
      } } }

  assert.equal(render('${{local.tagFor(`<p>${local.value}</p>`)`opaque\\n${local.value}`}}', context), '<p>' + escaped + '</p>')
  assert.equal(render('${local.tagFor(`${{local.value}}`)`opaque\\n${local.value}`}', context), escaped)
  assert.deepEqual(calls, [['<p>' + escaped + '</p>', 'opaque\\n', value], [value, 'opaque\\n', value]])
  assert.equal(render('${{local.tagFor(`<p>${local.value}</p>`)`opaque${local.value}`}}', context, 'text/plain'), '<p>' + value + '</p>')
})


for ( let [name, source] of [
  ['regex modifiers', '${/(?i:a)/.test("A") ? local.value : ""}'],
  ['duplicate named regex capture groups', '${/(?<x>a)|(?<x>b)/.test("b") ? local.value : ""}'],
  ['using declarations', '${(() => { using resource = local.resource; return local.value })()}']
] ) {
  test('compiler accepts native ' + name, context => {
    // Supported Node versions have different syntax capabilities. Only skip
    // when the native renderer itself cannot parse this expression.
    try {
      new Function('local', 'return `' + source + '`')
    } catch (err) {
      if ( err instanceof SyntaxError ) {
        context.skip('Syntax is unavailable in ' + process.version)
        return
      }
      throw err
    }
    let disposals = 0,
        local = { value, resource: { [Symbol.dispose]() { disposals++ } } }

    assert.equal(render(source, { local }), escaped)
    assert.equal(disposals, name === 'using declarations' ? 1 : 0)
  })
}


test('helper names avoid literal and Unicode-escaped view identifiers', () => {
  let context = { local: { items: [x => x], value } }

  assert.equal(render('${{local.items.map($ctzn0 => `<p>${local.value}</p>`).join(\'\')}}', context), '<p>' + escaped + '</p>')
  assert.equal(render(String.raw`${'${{'}local.items.map(\u0024ctzn0 => ${'`<p>${local.value}</p>`'}).join('')${'}}'}`, context), '<p>' + escaped + '</p>')
  assert.equal(render('${{local.items.map($ctznEscape => `<p>${local.value}</p>`).join(\'\')}}', context), '<p>' + escaped + '</p>')
})


test('malformed source fails compilation with the view path and parser locations', () => {
  for ( let source of ['${}', '${{}}', '${{value}', '${{value}X', '${{value} }', '${value', '${{a: 1}}', '${{value}}`'] ) {
    assert.throws(() => compileTemplate(source, '/views/broken.html'), err => {
      assert.ok(err instanceof SyntaxError)
      assert.match(err.message, /\/views\/broken.html/)
      assert.ok(err.loc)
      return true
    })
  }
  globalThis.ctznCompileProbe = 0
  try {
    let compiled = compileTemplate('${++globalThis.ctznCompileProbe}', '/views/side-effects.html')

    assert.equal(globalThis.ctznCompileProbe, 0)
    assert.equal(compiled(), '1')
  } finally {
    delete globalThis.ctznCompileProbe
  }
})


test('compile errors report positions in the original view on first and later lines', () => {
  for ( let [source, line, column] of [
    ['hello ${}', 1, 8],
    ['intro\nhello ${}', 2, 8],
    ['intro\r\nhello ${}', 2, 8],
    ['intro\u2028hello ${}', 2, 8],
    ['hello ${{local.value}X', 1, 20]
  ] ) {
    assert.throws(() => compileTemplate(source, '/views/location.html'), err => {
      assert.deepEqual({ ...err.loc }, { line, column })
      assert.equal(err.pos, source.lastIndexOf('}'))
      assert.ok(err.message.endsWith('(' + line + ':' + column + ')'))
      assert.match(err.message, /\/views\/location.html/)
      return true
    })
  }
})


test('plain-text mode normalizes raw syntax without adding HTML entities', () => {
  assert.equal(render('${local.value}|${{local.value}}|${{ `<p>${local.value}</p>` }}', { local: { value } }, 'text/plain'), value + '|' + value + '|<p>' + value + '</p>')
})


test('memoization keys on path, mode, and current source without stale fallback', () => {
  let viewPath = '/views/memo.html',
      first = getTemplate(viewPath, '${local.value}'),
      plain = getTemplate(viewPath, '${local.value}', 'text/plain')

  assert.equal(getTemplate(viewPath, '${local.value}'), first)
  assert.notEqual(plain, first)
  assert.equal(first({ local: { value } }), escaped)
  assert.equal(first({ local: { value: '&' } }), '&amp;')
  assert.equal(plain({ local: { value } }), value)
  let changed = getTemplate(viewPath, '${{local.value}}')

  assert.notEqual(changed, first)
  assert.equal(changed({ local: { value } }), value)
  for ( let attempt = 0; attempt < 2; attempt++ ) {
    assert.throws(() => getTemplate(viewPath, '${{local.value}X'), /Could not compile view/)
  }
  assert.equal(getTemplate(viewPath, '${{local.value}}'), changed)
  assert.equal(getTemplate(viewPath, '${local.value}', 'text/plain'), plain)
  assert.notEqual(getTemplate('/views/another.html', '${{local.value}}'), changed)
})


test('documented JSON script-data examples prevent closing tags and round-trip data', () => {
  let docs = ['../README.md', '../MIGRATION.md'].map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'),
      expressions = [...docs.matchAll(/`(JSON\.stringify\(state\)\.replaceAll\([^`]+\))`/g)],
      state = { payload: '</script><script>alert(1)</script><!--', other: '&"\'\\' }

  assert.ok(expressions.length)
  for ( let [, expression] of expressions ) {
    let json = vm.runInNewContext(expression, { state })

    assert.equal(json.includes('<'), false)
    assert.deepEqual(JSON.parse(json), state)
    assert.equal(render('<script type="application/json">${{local.json}}</script>', { local: { json } }), '<script type="application/json">' + json + '</script>')
  }
})
