import assert from 'node:assert/strict'
import test from 'node:test'
import router from '../lib/router.js'


const request = url => ({ url, headers: { host: 'example.test' } }),
      parse = url => router.parseRoute(request(url), 'http')


test('query scope decodes flat strings independently of citizen path parameters', () => {
  for ( let [url, pathParams, queryParams] of [
    ['/article', {}, {}], ['/article?id=237&page=2', {}, { id: '237', page: '2' }],
    ['/article/id/237?id=999', { id: '237' }, { id: '999' }],
    ['/article?tag=first&tag=last', {}, { tag: 'last' }],
    ['/article?label=two+words&literal=%2B', {}, { label: 'two words', literal: '+' }],
    ['/article?empty=&flag', {}, { empty: '', flag: '' }],
    ['/article?filter%5Bid%5D=237&a.b=flat', {}, { 'filter[id]': '237', 'a.b': 'flat' }],
    ['/article/q/a%20b?q=a%20b', { q: 'a%20b' }, { q: 'a b' }],
    ['/article?%61=first&a=last&A=upper&=empty', {}, { a: 'last', A: 'upper', '': 'empty' }],
    ['/article?caf%C3%A9=%F0%9F%8C%8E&bad=%ZZ&utf=%FF', {}, { café: '🌎', bad: '%ZZ', utf: '�' }]
  ] ) {
    assert.deepEqual(parse(url).urlParams, pathParams, url)
    assert.deepEqual(parse(url).queryParams, queryParams, url)
  }
})


test('framework fields are selected exclusively by the citizen path', () => {
  for ( let [url, action, descriptor, direct] of [
    ['/article?action=edit&article=Title&direct=true', 'handler', '', false],
    ['/article/action/edit?action=review', 'edit', '', false],
    ['/article/old-title?article=new-title', 'handler', 'old-title', false],
    ['/article/direct/false?direct=', 'handler', '', 'false'],
    ['/_article?direct=', 'handler', '', true]
  ] ) {
    let route = parse(url)
    assert.equal(route.action, action, url)
    assert.equal(route.descriptor, descriptor, url)
    assert.equal(route.direct, direct, url)
  }
  assert.equal(parse('/article?controller=other').controller, 'article')
  assert.equal(parse('/?index=home').descriptor, '')
})


test('query parsing retains the untouched request and replacement route URLs', () => {
  let httpRequest = request('/article/id/237?id=999&id=998#fragment'), original = structuredClone(httpRequest),
      route = router.parseRoute(httpRequest, 'http')

  assert.equal(route.url, 'http://example.test/article/id/237?id=999&id=998#fragment')
  assert.equal(route.pathname, '/article/id/237')
  assert.deepEqual(route.urlParams, { id: '237' })
  assert.deepEqual(route.queryParams, { id: '998' })
  assert.deepEqual(httpRequest, original)
  let replacement = router.parseRoute(httpRequest, 'http', '/_head?action=meta')
  assert.deepEqual(replacement.urlParams, {})
  assert.deepEqual(replacement.queryParams, { action: 'meta' })
  assert.equal(replacement.action, 'handler')
  assert.equal(replacement.pathname, '/_head')
})


test('special query names remain ordinary own properties without changing path params', () => {
  let route = parse('/article?__proto__=query&constructor=C&prototype=P&_onTimeout=T'),
      expected = Object.fromEntries([['__proto__', 'query'], ['constructor', 'C'], ['prototype', 'P'], ['_onTimeout', 'T']])

  assert.deepEqual(route.urlParams, {})
  assert.deepEqual(route.queryParams, expected)
  assert.equal(Object.getPrototypeOf(route.queryParams), Object.prototype)
  assert.equal(Object.getOwnPropertyDescriptor(route.queryParams, '__proto__').value, 'query')
})


test('static URLs with queries keep pathname-based file selection', () => {
  let route = parse('/asset.css?v=2')

  assert.equal(route.isStatic, true)
  assert.equal(route.filePath, '/asset.css')
  assert.equal(route.extension, 'css')
  assert.equal(route.urlParams, undefined)
})
