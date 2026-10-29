import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { fixture, request, until } from './support/http-fixture.js'

const files = {
  'app/controllers/routes/problem.js': `
    import { setTimeout as delay } from 'node:timers/promises'
    export const config = { controller: { contentTypes: ['application/json', 'application/javascript', 'text/event-stream', 'text/csv'] }, managed: { streaming: { enabled: true } }, slow: { streaming: { enabled: true } } }
    export const handler = (params, request, response) => {
      let err = Object.assign(new Error('diagnostic detail'), { statusCode: Number(request.headers['x-status']) || 500, result: request.headers['x-policy'] })
      if ( request.headers['x-write'] ) response.write('already committed')
      if ( request.headers['x-end'] ) response.end('already ended')
      throw err
    }
    export const managed = handler
    export const plain = () => { throw { statusCode: 422, result: 'exit', message: 'error-like object' } }
    export const slow = async (params, request) => {
      process.send({ type: 'setup' })
      await delay(150, undefined, request.headers['x-bug'] ? {} : { signal: request.signal })
      if ( request.headers['x-bug'] ) throw new Error('late genuine bug')
      return { local: { shouldNotRender: true } }
    }
  `,
  'app/controllers/routes/layout.js': 'export const handler = () => ({ local: { layout: true } })'
}

test('JSON and JSONP error bodies retain diagnostic fields with and without layout', async t => {
  for ( let layout of ['', 'layout'] ) {
    let app = await fixture(t, files, { layout: { controller: layout, view: layout } })
    for ( let accept of ['application/json', 'application/javascript', 'text/event-stream', 'text/csv', 'unavailable/type'] ) {
      let result = await request(app.port, '/problem', { headers: { accept } })
      assert.equal(result.status, 500)
      assert.match(result.body, /diagnostic detail/)
      assert.match(result.body, /"stack":/)
      assert.doesNotMatch(result.body, /<html/)
      if ( !['application/json', 'application/javascript'].includes(accept) ) {
        assert.equal(result.headers['content-type'], 'application/json')
        assert.equal(JSON.parse(result.body).layout, undefined)
      }
    }
    let missing = await request(app.port, '/missing', { headers: { accept: 'text/event-stream' } })
    assert.equal(missing.status, 404)
    assert.equal(missing.headers['content-type'], 'application/json')
    assert.match(missing.body, /"stack":/)
  }
})

test('4xx stays nonfatal under exit before/after commit and after end, even with an exit override', async t => {
  let app = await fixture(t, files, { errors: 'exit' })
  for ( let action of ['', '/action/managed'] ) {
    for ( let header of [{}, { 'x-write': 'yes' }, { 'x-end': 'yes' }] ) {
      let result = await request(app.port, '/problem' + action, { headers: { accept: 'application/json', 'x-status': '422', 'x-policy': 'exit', ...header } }).catch(error => {
        assert.equal(error.code, 'ECONNRESET')
        assert.ok(header['x-write'])
      })
      if ( result ) {
        assert.ok([200, 422].includes(result.status))
      }
      assert.equal(app.child.exitCode, null)
    }
  }
  assert.equal(app.messages.filter(message => message.type === 'error').length, 0)
  let object = await request(app.port, '/problem/action/plain')
  assert.equal(object.status, 422)
  assert.equal(JSON.parse(object.body).error.error.message, 'error-like object')
  assert.equal((await request(app.port, '/missing', { headers: { accept: 'application/json' } })).status, 404)
})

test('genuine 5xx exits before/after commit and after end; capture overrides exit', async t => {
  for ( let header of [{}, { 'x-write': 'yes' }, { 'x-end': 'yes' }] ) {
    let app = await fixture(t, files, { errors: 'exit' })
    await request(app.port, '/problem', { headers: { accept: 'application/json', ...header } }).catch(() => {})
    await until(() => app.child.exitCode !== null)
    assert.equal(app.child.exitCode, 1)
  }
  let app = await fixture(t, files, { errors: 'exit' })
  assert.equal((await request(app.port, '/problem', { headers: { 'x-policy': 'capture' } })).status, 500)
  assert.equal(app.child.exitCode, null)
})

test('buffered setup cancellation completes once without calling the error hook; genuine late bugs remain errors', async t => {
  let app = await fixture(t, files)
  for ( let bug of [false, true] ) {
    let setupCount = app.messages.filter(message => message.type === 'setup').length,
        call = http.get({ hostname: '127.0.0.1', port: app.port, path: '/problem/action/slow?bug=' + bug, headers: bug ? { 'x-bug': 'yes' } : {} })
    call.on('error', () => {})
    await until(() => app.messages.filter(message => message.type === 'setup').length > setupCount)
    call.destroy()
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.deepEqual(app.messages.filter(message => message.type === 'end').map(message => message.outcome), ['cancelled', 'cancelled'])
  assert.deepEqual(app.messages.filter(message => message.type === 'error').map(message => message.message), ['late genuine bug'])
  assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
})

test('error hooks may yield, throw, change formats, or end responses without recursive reporting', async t => {
  for ( let behavior of ['throw new Error("hook failed")', 'response.contentType = "application/json"', 'response.end("hook ended")'] ) {
    let app = await fixture(t, { ...files, 'app/controllers/hooks/application.js': `export const error = async (params, request, response) => { await new Promise(resolve => setImmediate(resolve)); ${behavior} }` })
    let result = await request(app.port, '/problem/action/managed', { headers: { accept: 'text/event-stream' } })
    assert.ok(result.body.includes('diagnostic detail') || result.body === 'hook ended')
    assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
    assert.equal(app.child.exitCode, null)
  }
})

test('a throwing error layout preserves JSON diagnostics rather than labeling HTML as JSON', async t => {
  let app = await fixture(t, { ...files, 'app/controllers/routes/layout.js': 'export const handler = () => { throw new Error("layout failed") }' }, { layout: { controller: 'layout', view: 'layout' } })
  let result = await request(app.port, '/problem', { headers: { accept: 'application/json' } })
  assert.equal(result.status, 500)
  let body = JSON.parse(result.body)
  assert.equal(body.error.error.message, 'diagnostic detail')
  assert.equal(body.error.error.handlingError.message, 'layout failed')
  assert.match(body.error.error.stack, /diagnostic detail/)
})

test('a serialization failure uses the normal diagnostic envelope without re-entering error hooks', async t => {
  for ( let layout of ['', 'layout'] ) {
    let app = await fixture(t, {
      'app/controllers/routes/problem.js': `
        export const config = { controller: { streaming: { enabled: true }, contentTypes: ['application/json', 'application/javascript', 'text/event-stream'] } }
        export const handler = (params, request) => {
          if ( request.headers['x-buffered'] ) return { local: { detail: 1n } }
          throw Object.assign(new Error('original failure'), { code: 'FIXTURE_ERROR', detail: 1n })
        }
      `,
      'app/controllers/routes/layout.js': files['app/controllers/routes/layout.js'],
      // IPC uses JSON too; report lifecycle state without serializing the fixture's BigInt again.
      'app/controllers/hooks/response.js': 'export const end = (params, request, response) => process.send({ type: "end", outcome: response.completion, aborted: request.signal.aborted })'
    }, { layout: { controller: layout, view: layout } })
    for ( let accept of ['application/json', 'application/javascript', 'text/event-stream'] ) {
      let result = await request(app.port, '/problem/callback/show', { headers: { accept } }),
          jsonp = accept === 'application/javascript'
      assert.equal(result.status, 500)
      assert.equal(result.headers['content-type'], jsonp ? accept : 'application/json')
      if ( jsonp ) {
        assert.match(result.body, /^show\(.*\);$/s)
      }
      let body = JSON.parse(jsonp ? result.body.slice(5, -2) : result.body),
          error = body.error.error
      assert.equal(error.errorCode, 'FIXTURE_ERROR')
      assert.equal(error.statusCode, 500)
      assert.equal(error.label, '500 Internal Server Error')
      assert.equal(error.message, 'original failure')
      assert.match(error.stack, /Error: original failure/)
      assert.equal(Object.hasOwn(error, 'raw'), false)
      assert.match(error.handlingError.message, /BigInt/)
      assert.match(error.handlingError.stack, /TypeError/)
      assert.equal(body.layout?.layout, layout && accept !== 'text/event-stream' ? true : undefined)
    }
    let head = await request(app.port, '/problem', { method: 'HEAD' })
    assert.equal(head.status, 500)
    assert.equal(head.body, '')
    // Unserializable ordinary output must still fail instead of being silently altered.
    let buffered = await request(app.port, '/problem', { headers: { 'x-buffered': 'yes' } })
    assert.equal(buffered.status, 500)
    assert.match(JSON.parse(buffered.body).error.error.stack, /TypeError:.*BigInt/)
    await until(() => app.messages.filter(message => message.type === 'end').length === 5)
    assert.equal(app.messages.filter(message => message.type === 'error').length, 5)
    assert.ok(app.messages.filter(message => message.type === 'end').every(message => message.outcome === 'failed' && message.aborted))
    assert.doesNotMatch(app.output, /Unhandled promise rejection|ERR_HTTP_HEADERS_SENT|Error handling failed/)
  }
})

test('reporting failures close the response and finish cleanup without another renderer', async t => {
  let helpersUrl = new URL('../lib/helpers.js', import.meta.url).href,
      app = await fixture(t, {
        'app/controllers/routes/problem.js': `
          import helpers from ${JSON.stringify(helpersUrl)}
          import { setTimeout as delay } from 'node:timers/promises'
          export const config = { controller: { streaming: { enabled: true }, contentTypes: ['text/plain'] } }
          export const handler = (params, request) => {
            let log = helpers.log
            helpers.log = options => {
              if ( options.type === 'error:server' ) {
                helpers.log = log
                throw new Error('reporting failed')
              }
              return log(options)
            }
            if ( !request.headers['x-stream'] ) throw new Error('original failure')
            return (async function* () {
              try {
                yield 'first chunk'
                await delay(20)
                throw new Error('producer failed')
              } finally { process.send({ type: 'cleanup' }) }
            })()
          }
        `
      })
  await assert.rejects(request(app.port, '/problem'), { code: 'ECONNRESET' })
  let stream = await request(app.port, '/problem', { headers: { 'x-stream': 'yes' } })
  assert.equal(stream.status, 200)
  assert.equal(stream.body, 'first chunk')
  assert.equal(stream.aborted, true)
  await until(() => app.messages.filter(message => message.type === 'end').length === 2)
  assert.equal(app.messages.filter(message => message.type === 'cleanup').length, 1)
  assert.equal(app.messages.filter(message => message.type === 'error').length, 0)
  assert.ok(app.messages.filter(message => message.type === 'end').every(message => message.outcome === 'failed' && message.aborted))
  assert.match(app.output, /reporting failed/)
  assert.doesNotMatch(app.output, /Unhandled promise rejection|ERR_HTTP_HEADERS_SENT/)
})
