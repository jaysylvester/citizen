import { parse } from 'acorn'


const allowedRoots = new Set(['params', 'request', 'response', 'context']),
      parameterScopes = ['config', 'cookie', 'form', 'payload', 'query', 'route', 'session', 'url'],
      forbiddenProperties = new Set(['__proto__', 'constructor', 'prototype']),
      invalidSelector = 'Debug inspection unavailable: invalid property selector.',
      failedRead = 'Debug inspection unavailable: property read failed.'


export function debugScopes(params, scopes, context) {
  let logContent = {}

  for ( let scope of parameterScopes ) {
    if ( scopes[scope] ) {
      logContent[scope] = params[scope]
    }
  }
  if ( context !== undefined && scopes.context ) {
    logContent.context = context
  }

  return logContent
}


export function debugValue(selector, roots) {
  let properties = [], root

  // Validate the complete path before accessing roots or running any getters.
  try {
    if ( typeof selector !== 'string' ) {
      return invalidSelector
    }
    let program = parse(selector, { ecmaVersion: 'latest', preserveParens: true })

    if ( program.body.length !== 1 || program.body[0].type !== 'ExpressionStatement' ) {
      return invalidSelector
    }
    let expression = program.body[0].expression

    while ( expression.type === 'MemberExpression' && !expression.optional ) {
      let property

      if ( expression.computed ) {
        if ( expression.property.type !== 'Literal' ||
             !(typeof expression.property.value === 'string' ||
               Number.isSafeInteger(expression.property.value) && expression.property.value >= 0) ) {
          return invalidSelector
        }
        property = expression.property.value
      } else {
        if ( expression.property.type !== 'Identifier' ) {
          return invalidSelector
        }
        property = expression.property.name
      }
      if ( forbiddenProperties.has(property) ) {
        return invalidSelector
      }
      properties.push(property)
      expression = expression.object
    }

    if ( expression.type !== 'Identifier' || !allowedRoots.has(expression.name) ) {
      return invalidSelector
    }
    root = expression.name
  } catch {
    return invalidSelector
  }

  try {
    let value = roots[root]

    for ( let property of properties.reverse() ) {
      if ( value === null || value === undefined ) {
        return undefined
      }
      value = value[property]
    }
    return value
  } catch {
    return failedRead
  }
}
