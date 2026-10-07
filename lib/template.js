import { Parser, tokTypes } from 'acorn'


// This adapter uses Acorn 8.11.3's parseTemplate protocol. Keep the parser
// pinned and run the grammar suite before updating it. Acorn owns expression
// parsing and tokenizer contexts, including the extra raw-marker braces.
const ViewParser = Parser.extend(Base => class extends Base {
  parseTemplate({ isTagged = false } = {}) {
    let node = this.startNode(),
        taggedDepth = this.ctznTaggedDepth || 0

    this.ctznTaggedDepth = taggedDepth + Number(isTagged)
    try {
      this.next()
      node.expressions = []
      node.ctznInterpolations = []
      let element = this.parseTemplateElement({ isTagged })

      node.quasis = [element]
      while ( !element.tail ) {
        let opening = this.start,
            raw = this.input[opening + 2] === '{'

        this.expect(tokTypes.dollarBraceL)
        if ( raw ) {
          if ( this.ctznTaggedDepth ) {
            this.raise(opening, 'Raw interpolation is not allowed inside a tagged template')
          }
          this.expect(tokTypes.braceL)
        }
        node.expressions.push(this.parseExpression())
        let rawClosing

        if ( raw ) {
          rawClosing = this.start
          if ( this.type !== tokTypes.braceR || this.input[rawClosing + 1] !== '}' ) {
            this.raise(rawClosing, 'Raw interpolation requires adjacent closing braces (}})')
          }
          this.next()
        }
        node.ctznInterpolations.push({ opening, closing: this.start, raw, rawClosing })
        this.expect(tokTypes.braceR)
        node.quasis.push(element = this.parseTemplateElement({ isTagged }))
      }
      this.next()
      return this.finishNode(node, 'TemplateLiteral')
    } finally {
      this.ctznTaggedDepth = taggedDepth
    }
  }
})

const scopes = ['config', 'cookie', 'form', 'local', 'payload', 'route', 'session', 'url', 'include'],
      memo = new Map(),
      entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }


// Internal export for server error fallbacks; index.js does not expose it.
export function escapeHtml(value) {
  return `${value}`.replace(/[&<>"']/g, character => entities[character])
}


function children(node) {
  return Object.values(node).flatMap(value => {
    if ( Array.isArray(value) ) {
      return value.filter(item => item && typeof item.type === 'string')
    }
    return value && typeof value.type === 'string' ? [value] : []
  })
}


function isDirectInclude(node) {
  return node.type === 'MemberExpression' && !node.optional &&
    node.object.type === 'Identifier' && node.object.name === 'include' &&
    (node.computed
      ? node.property.type === 'Literal' && typeof node.property.value === 'string'
      : node.property.type === 'Identifier')
}


export function compileTemplate(source, viewPath, contentType = 'text/html') {
  let prefix = '(function(' + scopes.join(', ') + ') {',
      body = 'return `' + source + '`',
      input = prefix + body + '})'

  try {
    let tree = ViewParser.parse(input, { ecmaVersion: 'latest', sourceType: 'script' }),
        statements = tree.body[0].expression.body.body,
        root = statements[0]?.argument,
        names = new Set(scopes),
        collect = node => {
          if ( node.type === 'Identifier' ) {
            names.add(node.name)
          }
          children(node).forEach(collect)
        }

    if ( statements.length !== 1 || statements[0].type !== 'ReturnStatement' || root?.type !== 'TemplateLiteral' ) {
      throw new SyntaxError('View must be a single template literal')
    }
    collect(tree)
    let helperIndex = 0

    while ( names.has('$ctzn' + helperIndex) ) {
      helperIndex++
    }
    let helper = '$ctzn' + helperIndex,
        edits = [],
        visit = (node, markup) => {
          if ( node.type === 'TaggedTemplateExpression' ) {
            return
          }
          if ( node.type === 'TemplateLiteral' ) {
            transform(node, markup)
          } else {
            children(node).forEach(child => visit(child, markup))
          }
        },
        transform = (node, markup) => {
          node.expressions.forEach((expression, index) => {
            let marker = node.ctznInterpolations[index]

            if ( marker.raw ) {
              edits.push({ start: marker.opening + 2, end: marker.opening + 3, text: '' })
              edits.push({ start: marker.rawClosing, end: marker.rawClosing + 1, text: '' })
            } else if ( markup && !(node === root && isDirectInclude(expression)) ) {
              // Use the interpolation's full range to preserve parentheses,
              // leading/trailing comments, and sequence expressions.
              edits.push({ start: marker.opening + 2, end: marker.opening + 2, text: helper + '((' })
              edits.push({ start: marker.closing, end: marker.closing, text: '))' })
            }
            visit(expression, markup && marker.raw)
          })
        }

    transform(root, contentType === 'text/html')
    edits.sort((left, right) => left.start - right.start)
    let cursor = prefix.length,
        transformed = ''

    for ( let edit of edits ) {
      transformed += input.slice(cursor, edit.start) + edit.text
      cursor = edit.end
    }
    transformed += input.slice(cursor, prefix.length + body.length)
    let compiled = new Function(...scopes, helper, transformed)

    return (context = {}) => compiled(...scopes.map(name => name === 'include' ? context[name] || {} : context[name]), escapeHtml)
  } catch (err) {
    err.message = 'Could not compile view "' + viewPath + '": ' + err.message
    throw err
  }
}


// The caller reads the current source on every render. Each path/mode holds
// only its last successful compilation, never request data or rendered output.
export function getTemplate(viewPath, source, contentType = 'text/html') {
  let modes = memo.get(viewPath),
      previous = modes?.get(contentType)

  if ( previous?.source === source ) {
    return previous.render
  }
  let render = compileTemplate(source, viewPath, contentType)

  if ( !modes ) {
    modes = new Map()
    memo.set(viewPath, modes)
  }
  modes.set(contentType, { source, render })
  return render
}
