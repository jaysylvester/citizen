import assert from 'node:assert/strict'
import test from 'node:test'
import { debugScopes, debugValue } from '../lib/debug.js'
import helpers from '../lib/helpers.js'
import requestHooks from '../lib/hooks/request.js'
import responseHooks from '../lib/hooks/response.js'


test('request and post-response debug logs honor the shared query scope setting', async context => {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'CTZN'),
      params = { config: {}, cookie: {}, form: {}, payload: {}, query: { code: 'abc' },
                 route: { url: 'http://example.test/article?code=abc' }, session: {}, url: {} },
      scopes = { config: true, context: true, cookie: true, form: true, payload: true,
                 query: true, route: true, session: true, url: true },
      request = { remoteAddress: '127.0.0.1', headers: { 'user-agent': 'debug-test' }, method: 'GET' },
      response = { statusCode: 200 },
      requestContext = { marker: 'context' },
      logs = []

  context.after(() => {
    if ( previous ) {
      Object.defineProperty(globalThis, 'CTZN', previous)
    } else {
      delete globalThis.CTZN
    }
  })
  globalThis.CTZN = {
    config: { citizen: { mode: 'development', development: { debug: { scope: scopes } } } },
    controllers: { hooks: {} }
  }
  context.mock.method(helpers, 'log', options => logs.push(options))

  await requestHooks.end(params, request, response, requestContext)
  await responseHooks.end(params, request, response, requestContext)
  assert.deepEqual(logs.find(log => log.label.startsWith('Request parameters:')).content, params)
  assert.deepEqual(logs.find(log => log.label === 'Post-response parameters and context').content,
    { ...params, context: requestContext })
  assert.deepEqual(debugScopes(params, scopes, requestContext), { ...params, context: requestContext })

  scopes.query = false
  scopes.context = false
  logs.length = 0
  await requestHooks.end(params, request, response, requestContext)
  await responseHooks.end(params, request, response, requestContext)
  for ( let content of [...logs.filter(log => log.content).map(log => log.content), debugScopes(params, scopes, requestContext)] ) {
    assert.ok(!Object.hasOwn(content, 'query'))
    assert.ok(!Object.hasOwn(content, 'context'))
    assert.deepEqual(content.url, {})
  }

  CTZN.config.citizen.mode = 'production'
  logs.length = 0
  await requestHooks.end(params, request, response, requestContext)
  await responseHooks.end(params, request, response, requestContext)
  assert.ok(!logs.some(log => log.content))
})


test('debug selectors preserve roots, literal keys, indexes, inherited properties, and URL getters', () => {
  let url = new URL('https://example.test/article?tag=first&tag=last'),
      inherited = Object.create({ value: 'inherited' }),
      roots = {
        params: { route: { parsed: url }, query: { 'two words': 'literal', 'a.b': 'flat', café: 'unicode' }, absent: null },
        request: { socket: { get remoteAddress() { return '127.0.0.1' } } },
        response: { statusCode: 200 },
        context: { items: ['first', 'last'], inherited }
      }

  for ( let [selector, expected] of [
    ['params', roots.params], ['request', roots.request], ['response', roots.response], ['context', roots.context],
    ['params.query["two words"]', 'literal'], ['params.query[\'a.b\']', 'flat'],
    ['params.query["caf\\u00e9"]', 'unicode'], ['context.items[0]', 'first'], ['context.items[1]', 'last'],
    ['context.inherited.value', 'inherited'], ['params.route.parsed.href', url.href],
    ['params.route.parsed.pathname', url.pathname], ['params.route.parsed.searchParams', url.searchParams],
    ['request.socket.remoteAddress', roots.request.socket.remoteAddress], ['response.statusCode', 200],
    ['params.missing.child', undefined], ['params.absent.child', undefined], ['params.absent', null]
  ] ) {
    assert.equal(debugValue(selector, roots), expected, selector)
  }
})


test('debug validates all selector segments before root/property getters and never executes expressions', () => {
  let reads = 0, calls = 0,
      callable = () => { calls++; return 'called' },
      roots = { get params() { reads++; return { get child() { reads++; return { value: 'selected', callable } } } } }

  for ( let selector of [
    '', 'params[', 'globalThis', 'process.env', 'Math.max(1,2)',
    'params.child.callable()', 'params.child[params.child.callable()]', 'params.child["val"+"ue"]',
    'params.child.value=1', 'params;params.child', 'params,params.child', 'params.child||params',
    '(params.child)', '(params).child', 'params?.child', 'params.child?.value',
    'params.child[-1]', 'params.child[1.5]', 'params.child[true]', 'params.child[/value/]',
    'params.child[9007199254740992]', 'params.child.__proto__.value', 'params.child.constructor.name',
    'params.child.prototype', 'params.child["__proto__"]', 'params.child["prototype"]',
    'params.child["\\u0063onstructor"]', 'params.child.constr\\u0075ctor',
    42, null, { toString() { calls++; return 'params' } }
  ] ) {
    assert.equal(debugValue(selector, roots), 'Debug inspection unavailable: invalid property selector.')
    assert.equal(reads, 0)
    assert.equal(calls, 0)
  }
  assert.equal(debugValue('params.child.value', roots), 'selected')
  assert.equal(reads, 2)
  assert.equal(debugValue('params.child.callable', roots), callable)
  assert.equal(calls, 0)
})


test('debug property read failures use a bounded diagnostic without exposing the thrown error', () => {
  let failure = () => { throw new Error('private getter error') },
      roots = { request: Object.defineProperty({}, 'failure', { get: failure }) }

  assert.equal(debugValue('request.failure', roots), 'Debug inspection unavailable: property read failed.')
  assert.equal(debugValue('params.value', { get params() { return failure() } }), 'Debug inspection unavailable: property read failed.')
})
