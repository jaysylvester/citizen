import assert       from 'node:assert/strict'
import fs           from 'node:fs'
import os           from 'node:os'
import path         from 'node:path'
import test         from 'node:test'

import cache        from '../lib/cache.js'
import { getDefaults } from '../init/config.js'


test.beforeEach(() => {
  let config = getDefaults()

  config.citizen.cache.application.lifespan = 5
  config.citizen.cache.static.enabled = true
  config.citizen.cache.static.lifespan = 13
  config.citizen.logs.error = false
  global.CTZN = { cache: {}, config: config }
})


test.afterEach(() => {
  cache.clear()
  delete global.CTZN
})


test('cache.set uses application defaults for default and custom scopes', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })

  cache.set({ key: 'default', value: 'value' })
  cache.set({ scope: 'custom', key: 'custom', value: 'value' })
  assert.equal(CTZN.cache.app.default.lifespan, 300000)
  assert.equal(CTZN.cache.custom.custom.lifespan, 300000)

  context.mock.timers.tick(299999)
  assert.equal(cache.exists({ key: 'default' }), true)
  assert.equal(cache.exists({ scope: 'custom', key: 'custom' }), true)
  context.mock.timers.tick(1)
  assert.equal(cache.exists({ key: 'default' }), false)
  assert.equal(cache.exists({ scope: 'custom', key: 'custom' }), false)
})


test('cache.set honors explicit numeric lifespans for values and files', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })

  cache.set({ key: 'default', value: 'value', lifespan: 2 })
  cache.set({ scope: 'custom', key: 'custom', value: 'value', lifespan: 2 })
  cache.set({ file: '/fixture/numeric.txt', value: 'content', lifespan: 2 })
  assert.equal(CTZN.cache.app.default.lifespan, 120000)
  assert.equal(CTZN.cache.custom.custom.lifespan, 120000)
  assert.equal(CTZN.cache.files['/fixture/numeric.txt'].lifespan, 120000)

  context.mock.timers.tick(119999)
  assert.equal(cache.exists({ key: 'default' }), true)
  assert.equal(cache.exists({ scope: 'custom', key: 'custom' }), true)
  assert.equal(cache.exists({ file: '/fixture/numeric.txt' }), true)
  context.mock.timers.tick(1)
  assert.equal(cache.exists({ key: 'default' }), false)
  assert.equal(cache.exists({ scope: 'custom', key: 'custom' }), false)
  assert.equal(cache.exists({ file: '/fixture/numeric.txt' }), false)
})


test('cache.set keeps application lifespans without timers for values and files', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })

  cache.set({ key: 'default', value: 'value', lifespan: 'application' })
  cache.set({ scope: 'custom', key: 'custom', value: 'value', lifespan: 'application' })
  cache.set({ file: '/fixture/application.txt', value: 'content', lifespan: 'application' })

  for ( let entry of [CTZN.cache.app.default, CTZN.cache.custom.custom, CTZN.cache.files['/fixture/application.txt']] ) {
    assert.equal(entry.lifespan, 'application')
    assert.equal(entry.timer, false)
  }

  context.mock.timers.tick(86400000)
  assert.equal(cache.get({ key: 'default' }), 'value')
  assert.equal(cache.get({ scope: 'custom', key: 'custom' }), 'value')
  assert.equal(cache.get({ file: '/fixture/application.txt' }), 'content')
})


test('cache.set uses the static lifespan and historical application reset default for files', () => {
  CTZN.config.citizen.cache.static.resetOnAccess = false
  cache.set({ file: '/fixture/default.txt', value: 'content' })

  let entry = cache.get({ file: '/fixture/default.txt', output: 'all' })

  assert.equal(entry.lifespan, 780000)
  assert.equal(entry.resetOnAccess, true)
})


test('cache.set retains explicit false reset options and retrieval honors stored options', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })

  cache.set({ key: 'fixed', value: 'value', resetOnAccess: false })
  cache.set({ scope: 'custom', key: 'fixed', value: 'value', resetOnAccess: false })
  cache.set({ file: '/fixture/fixed.txt', value: 'content', resetOnAccess: false })
  cache.set({ key: 'sliding', value: 'value' })

  context.mock.timers.tick(100)
  cache.get({ key: 'fixed' })
  cache.get({ scope: 'custom' })
  cache.get({ file: '/fixture/fixed.txt' })
  cache.get({ key: 'sliding' })

  for ( let entry of [CTZN.cache.app.fixed, CTZN.cache.custom.fixed, CTZN.cache.files['/fixture/fixed.txt']] ) {
    assert.equal(entry.resetOnAccess, false)
    assert.equal(entry.lastAccessed, 1000)
  }
  assert.equal(CTZN.cache.app.sliding.lastAccessed, 1100)
})


test('cache.set stores, replaces, retrieves, and clears falsy values', () => {
  for ( let value of [false, 0, '', null] ) {
    cache.set({ key: 'falsy', value: 'previous', lifespan: 'application' })
    cache.set({ key: 'falsy', value: value, lifespan: 'application' })
    assert.equal(cache.exists({ key: 'falsy' }), true)
    assert.equal(cache.get({ key: 'falsy' }), value)
    cache.clear({ key: 'falsy' })
    assert.equal(cache.exists({ key: 'falsy' }), false)
  }

  cache.set({ file: '/fixture/empty.txt', value: '', lifespan: 'application' })
  assert.equal(cache.get({ file: '/fixture/empty.txt' }), '')

  // Preserve the existing omitted-value behavior while adding other falsy values.
  cache.set({ key: 'undefined', value: undefined })
  assert.equal(cache.exists({ key: 'undefined' }), false)
})


test('cache.set honors synchronous false over a true file-reading default', { timeout: 5000 }, async context => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-cache-')),
      file = path.join(root, 'data.json'),
      stat = fs.stat,
      complete,
      completed = new Promise(resolve => { complete = resolve })

  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, '{"loaded":true}')
  CTZN.config.citizen.cache.application.synchronous = true
  context.mock.method(fs, 'readFileSync', () => { throw new Error('Unexpected synchronous read') })
  context.mock.method(fs, 'stat', (file, callback) => {
    stat(file, (err, stats) => {
      callback(err, stats)
      complete()
    })
  })

  cache.set({ file: file, value: undefined, synchronous: false, parseJSON: true, lifespan: 'application' })
  assert.equal(cache.exists({ file: file }), false)
  await completed
  assert.deepEqual(cache.get({ file: file }), { loaded: true })
})


test('cache.set replaces a custom file key without clearing the file-path entry or leaking its old timer', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-file-key-')),
      file = path.join(root, 'article.txt')

  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(file, 'first')
  cache.set({ file: file, key: 'article', synchronous: true, lifespan: 5 })
  cache.set({ file: file, value: 'file-path entry', lifespan: 'application' })
  fs.writeFileSync(file, 'second')
  cache.set({ file: file, key: 'article', synchronous: true, lifespan: 'application' })

  assert.equal(cache.get({ file: 'article' }), 'second')
  assert.equal(cache.get({ file: file }), 'file-path entry')
  assert.equal(CTZN.cache.files.article.timer, false)
  context.mock.timers.tick(300000)
  assert.equal(cache.exists({ file: 'article' }), true)
  assert.equal(cache.get({ file: 'article' }), 'second')
})


test('cache.exists handles every valid lookup before insertion and after clearing', () => {
  let lookups = [
    { key: 'value' },
    { file: '/fixture/file.txt' },
    { scope: 'files' },
    { scope: 'custom' },
    { scope: 'custom', key: 'value' },
    { route: '/fixture' },
    { route: '/fixture', contentType: 'text/html' }
  ]

  for ( let lookup of lookups ) {
    assert.equal(cache.exists(lookup), false)
  }
  cache.set({ key: 'value', value: 'content', lifespan: 'application' })
  cache.set({ scope: 'custom', key: 'value', value: 'content', lifespan: 'application' })
  cache.set({ file: '/fixture/file.txt', value: 'content', lifespan: 'application' })
  cache.setRoute({ route: '/fixture', contentType: 'text/html', lifespan: 'application' })
  for ( let lookup of lookups ) {
    assert.equal(cache.exists(lookup), true)
  }
  cache.clear()
  for ( let lookup of lookups ) {
    assert.equal(cache.exists(lookup), false)
  }
  CTZN.cache.custom = {}
  CTZN.cache.routes = { '/fixture': {} }
  assert.equal(cache.exists({ scope: 'custom' }), false)
  assert.equal(cache.exists({ route: '/fixture' }), false)
})


test('cache.exists retains errors for empty or unrecognized lookup shapes', () => {
  for ( let options of [{}, { contentType: 'text/html' }, { key: '' }, { unrelated: true }] ) {
    assert.throws(() => cache.exists(options), /Missing arguments/)
  }
})


test('cache.clear isolates content types with and without expiration timers', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })

  for ( let lifespan of ['application', 5] ) {
    cache.setRoute({ route: '/fixture', contentType: 'text/html', lifespan: lifespan })
    cache.setRoute({ route: '/fixture', contentType: 'application/json', lifespan: 7 })
    cache.setRoute({ route: '/other', contentType: 'application/json', lifespan: 'application' })
    cache.clear({ route: '/fixture', contentType: 'text/plain' })
    assert.equal(cache.exists({ route: '/fixture', contentType: 'text/html' }), true)
    assert.equal(cache.exists({ route: '/fixture', contentType: 'application/json' }), true)
    cache.clear({ route: '/fixture', contentType: 'text/html' })
    assert.equal(cache.exists({ route: '/fixture', contentType: 'text/html' }), false)
    assert.equal(cache.exists({ route: '/fixture', contentType: 'application/json' }), true)
    context.mock.timers.tick(300000)
    assert.equal(cache.exists({ route: '/fixture', contentType: 'application/json' }), true)
    // Omitting contentType clears the entire route and cancels its remaining timers.
    cache.clear({ route: '/fixture' })
    assert.equal(cache.exists({ route: '/fixture' }), false)
    assert.equal(cache.exists({ route: '/other' }), true)
    context.mock.timers.tick(120000)
  }
})


for ( let lifespan of ['application', 2] ) {
  test('cache.setRoute retains the first entry with lifespan ' + lifespan + ' until clearing or expiry', context => {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
    let timers = context.mock.method(global, 'setTimeout')

    cache.setRoute({
      route: '/fixture', contentType: 'text/html', lifespan: lifespan,
      output: 'first', encodings: { identity: 'first' }, context: { local: { version: 'first' } },
      lastModified: '2020-01-02T03:04:05.000Z', lastAccessed: Date.now(), resetOnAccess: false
    })
    cache.setRoute({ route: '/fixture', contentType: 'application/json', output: '{}', lifespan: 'application' })
    let first = cache.getRoute({ route: '/fixture', contentType: 'text/html' }),
        timer = first.timer,
        json = cache.getRoute({ route: '/fixture', contentType: 'application/json' }),
        timerCount = timers.mock.callCount()

    context.mock.timers.tick(1000)
    for ( let duplicateLifespan of [3, 'application'] ) {
      cache.setRoute({
        route: '/fixture', contentType: 'text/html', lifespan: duplicateLifespan,
        output: 'later', encodings: { identity: 'later' }, context: { local: { version: 'later' } },
        lastModified: '2021-01-02T03:04:05.000Z', lastAccessed: Date.now(), resetOnAccess: true
      })
    }
    assert.equal(cache.getRoute({ route: '/fixture', contentType: 'text/html' }), first)
    assert.equal(first.output, 'first')
    assert.deepEqual(first.encodings, { identity: 'first' })
    assert.deepEqual(first.context, { local: { version: 'first' } })
    assert.equal(first.lastModified, '2020-01-02T03:04:05.000Z')
    assert.equal(first.lastAccessed, 1000)
    assert.equal(first.resetOnAccess, false)
    assert.equal(first.lifespan, lifespan === 'application' ? lifespan : 120000)
    assert.equal(first.timer, timer)
    assert.equal(timers.mock.callCount(), timerCount)
    assert.equal(cache.getRoute({ route: '/fixture', contentType: 'application/json' }), json)

    if ( lifespan === 'application' ) {
      context.mock.timers.tick(86400000)
      assert.equal(cache.getRoute({ route: '/fixture', contentType: 'text/html' }), first)
      cache.clear({ route: '/fixture', contentType: 'text/html' })
    } else {
      context.mock.timers.tick(118999)
      assert.equal(cache.exists({ route: '/fixture', contentType: 'text/html' }), true)
      context.mock.timers.tick(1)
    }
    assert.equal(cache.exists({ route: '/fixture', contentType: 'text/html' }), false)
    cache.setRoute({ route: '/fixture', contentType: 'text/html', output: 'refilled', lifespan: 'application' })
    assert.equal(cache.getRoute({ route: '/fixture', contentType: 'text/html' }).output, 'refilled')
    assert.equal(cache.getRoute({ route: '/fixture', contentType: 'application/json' }), json)
  })
}


test('route expiration removes only the expiring content type', context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  cache.setRoute({ route: '/fixture', contentType: 'text/html', lifespan: 2 })
  cache.setRoute({ route: '/fixture', contentType: 'application/json', lifespan: 5 })
  cache.setRoute({ route: '/fixture', contentType: 'text/plain', lifespan: 'application' })

  context.mock.timers.tick(120000)
  assert.equal(cache.exists({ route: '/fixture', contentType: 'text/html' }), false)
  assert.equal(cache.exists({ route: '/fixture', contentType: 'application/json' }), true)
  assert.equal(cache.exists({ route: '/fixture', contentType: 'text/plain' }), true)
  context.mock.timers.tick(180000)
  assert.equal(cache.exists({ route: '/fixture', contentType: 'application/json' }), false)
  assert.equal(cache.exists({ route: '/fixture', contentType: 'text/plain' }), true)
  cache.clear({ route: '/fixture', contentType: 'text/plain' })
  assert.equal(cache.exists({ route: '/fixture' }), false)
})
