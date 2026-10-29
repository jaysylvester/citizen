import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, open, request, until } from './support/http-fixture.js'

const routes = `
  import { Readable } from 'node:stream'
  import { setTimeout as delay } from 'node:timers/promises'
  export const config = {
    controller: { streaming: { enabled: true }, contentTypes: ['application/json', 'text/event-stream', 'application/octet-stream'] },
    raw: { contentTypes: ['application/octet-stream'] },
    invalid: { streaming: { enabled: 'true' } },
    ordinary: { streaming: { enabled: false } }
  }
  let count = 0
  const source = (request, mode) => {
    let pulls = 0
    return {
      [Symbol.asyncIterator]() { return this },
      async next() {
        process.send({ type: 'pull', url: request.url })
        if ( mode === 'pending' ) return new Promise(() => {})
        if ( pulls++ === 0 ) return { value: mode === 'raw' ? '雪' : { id: '雪', event: 'progress', data: { value: '😀' } }, done: false }
        if ( mode === 'failure' ) throw new Error('producer failed')
        await delay(120)
        return { done: true }
      },
      async return() { process.send({ type: 'dispose', url: request.url }); return { done: true } }
    }
  }
  export const handler = async (params, request, response) => {
    count++
    if ( request.headers['x-delay'] ) await delay(150, undefined, { signal: request.signal })
    if ( request.headers['x-late-bug'] ) { await delay(150); throw new Error('late genuine bug') }
    if ( request.headers['x-status'] ) response.statusCode = Number(request.headers['x-status'])
    if ( request.headers['x-throw'] ) throw Object.assign(new Error('setup failed'), { statusCode: Number(request.headers['x-throw']) })
    if ( request.headers['x-force'] ) response.contentType = request.headers['x-force']
    if ( response.contentType === 'application/json' && !request.headers['x-descriptor'] ) return { local: { count, type: response.contentType, id: request.lastEventId, payload: params.payload }, ...(request.headers['x-cache'] ? { cache: { action: {} } } : {}) }
    if ( request.headers['x-bodyless'] ) return { view: false, next: { controller: 'missing' }, include: { missing: '/missing' } }
    let result = {
      local: { metadata: true },
      stream: { format: 'sse', source: source(request, request.headers['x-mode']), heartbeat: request.headers['x-mode'] === 'pending' ? 40 : false, retry: 3000 },
      header: { 'X-Action': 'yes', ...(request.headers['x-header-type'] ? { 'Content-Type': request.headers['x-header-type'] } : {}) },
      cookie: { action: 'yes' }, session: { streamValue: 'retained' }
    }
    if ( request.headers['x-next'] ) result.next = { controller: 'missing' }
    if ( request.headers['x-cache'] ) result.cache = { request: {} }
    if ( request.headers['x-invalid'] ) result.stream.heartbeat = 0
    if ( request.headers['x-write'] ) { response.write('manual'); }
    return result
  }
  export const raw = async (params, request) => ({ stream: source(request, 'raw'), header: request.headers['x-length'] ? { 'Content-Length': request.headers['x-length'] } : {} })
  export const readable = () => Readable.from(['first', Buffer.from([0, 255]), new Uint8Array([42])])
  export const ordinary = handler
  export const invalid = (params, request) => { process.send({ type: 'invalid-ran', signal: !!request.signal }); return {} }
  export const include = () => ({ include: { child: '/feed' } })
  export const chain = () => ({ next: { controller: 'feed', action: 'handler' } })
`
const files = {
  'app/controllers/routes/feed.js': routes,
  'app/controllers/hooks/response.js': `
    export const start = (params, request) => ({ header: { 'X-Action': 'first hook value', 'x-action': 'second hook value', 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff', ...(request.headers['x-buffer'] ? { 'x-accel-buffering': request.headers['x-buffer'] } : {}) }, cookie: { hook: 'yes' }, ...(request.headers['x-redirect'] ? { redirect: request.headers['x-redirect'] === 'refresh' ? { url: '/target', refresh: 0 } : '/target' } : {}) })
    export const end = (params, request, response, context) => process.send({ type: 'end', url: request.url, outcome: response.completion, aborted: request.signal?.aborted, hasStream: Object.hasOwn(context, 'stream'), local: context.local })
  `,
  'app/controllers/routes/layout.js': 'export const handler = () => { throw new Error(\'layout must not render streams\') }'
}
const sse = { accept: 'text/event-stream' }

test('managed SSE flushes headers, sends events incrementally, preserves directives, and completes once', async t => {
  let app = await fixture(t, files, { sessions: { enabled: true }, compression: { enabled: true, force: 'gzip' }, layout: { controller: 'layout', view: 'layout' } }),
      connection = await open(app.port, '/feed', { headers: sse })
  assert.equal(connection.response.statusCode, 200)
  assert.equal(connection.response.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(connection.response.headers['content-encoding'], undefined)
  assert.equal(connection.response.headers['x-accel-buffering'], 'no')
  assert.equal(connection.response.headers['cache-control'], 'no-store')
  assert.equal(connection.response.headers.etag, undefined)
  assert.equal(connection.response.headers['x-content-type-options'], 'nosniff')
  assert.equal(connection.response.headers['x-action'], 'yes')
  assert.equal(connection.response.headers['set-cookie'].length, 3)
  await until(() => Buffer.concat(connection.chunks).includes('data:'))
  assert.equal(connection.response.complete, false)
  let result = await connection.body
  assert.equal(result.body, 'retry: 3000\n\nevent: progress\nid: 雪\ndata: {"value":"😀"}\n\n')
  await until(() => app.messages.some(message => message.type === 'end'))
  assert.deepEqual(app.messages.filter(message => message.type === 'end').map(message => [message.outcome, message.hasStream, message.aborted]), [['finished', false, false]])
  assert.equal(app.messages.filter(message => message.type === 'dispose').length, 1)
  assert.equal(app.messages.filter(message => message.type === 'error').length, 0)
})

test('raw byte streams and exact Content-Length bypass rendering/compression', async t => {
  let app = await fixture(t, files, { compression: { enabled: true, force: 'gzip' } })
  let raw = await request(app.port, '/feed/action/raw', { headers: { 'x-length': '3' } })
  assert.equal(raw.body, '雪')
  assert.equal(raw.headers['content-length'], '3')
  let readable = await request(app.port, '/feed/action/readable', { headers: { accept: 'application/octet-stream' } })
  assert.deepEqual(readable.bytes, Buffer.concat([Buffer.from('first'), Buffer.from([0, 255, 42])]))
  for ( let length of ['2', '4', 'bad'] ) {
    let result = await request(app.port, '/feed/action/raw', { headers: { 'x-length': length } })
    assert.ok(result.aborted || result.status === 500)
  }
})

test('HEAD, bodyless statuses, and redirects do not pull sources or emit SSE controls', async t => {
  let app = await fixture(t, files)
  for ( let options of [
    { method: 'HEAD', headers: sse },
    { headers: { ...sse, 'x-status': '204' } },
    { headers: { accept: 'text/html', 'x-status': '204', 'x-bodyless': 'yes' } },
    { headers: { ...sse, 'x-redirect': 'server' } }
  ] ) {
    let result = await request(app.port, '/feed', options)
    assert.equal(result.body, '')
    assert.ok([200, 204, 302].includes(result.status))
    if ( result.status !== 200 ) {assert.equal(result.headers['x-accel-buffering'], undefined)}
  }
  assert.equal(app.messages.filter(message => message.type === 'pull').length, 0)
  assert.equal(app.messages.filter(message => message.type === 'dispose').length, 3)
})

test('contract failures are JSON 500s with stack; unmatched representations are 406s', async t => {
  let app = await fixture(t, files)
  for ( let [pathname, headers, status] of [
    ['/feed', { ...sse, 'x-next': 'yes' }, 500],
    ['/feed', { ...sse, 'x-invalid': 'yes' }, 500],
    ['/feed', { ...sse, 'x-status': '201' }, 500],
    ['/feed', { ...sse, 'x-header-type': 'application/json' }, 500],
    ['/feed', { ...sse, 'x-redirect': 'refresh' }, 500],
    ['/feed', { ...sse, 'x-cache': 'yes' }, 500],
    ['/feed', { accept: 'application/json', 'x-descriptor': 'yes' }, 500],
    ['/feed', { accept: 'text/html' }, 406],
    ['/feed/action/ordinary', sse, 500],
    ['/feed/action/invalid', sse, 500],
    ['/feed/action/include', { accept: 'application/json', 'x-descriptor': 'yes' }, 500],
    ['/feed/action/chain', { accept: 'application/json', 'x-descriptor': 'yes' }, 500]
  ] ) {
    let result = await request(app.port, pathname, { headers })
    assert.equal(result.status, status, pathname + JSON.stringify(headers) + result.body)
    assert.match(result.headers['content-type'], /application\/json/)
    assert.match(result.body, /"stack":/)
  }
  assert.equal(app.messages.filter(message => message.type === 'pull').length, 0)
  assert.equal(app.messages.filter(message => message.type === 'invalid-ran').length, 0)
})

test('dual-format buffered fallbacks bypass caches and preserve Last-Event-ID semantics', async t => {
  let app = await fixture(t, files)
  let first = await request(app.port, '/feed'), second = await request(app.port, '/feed')
  assert.equal(first.headers['x-accel-buffering'], undefined)
  assert.equal(JSON.parse(second.body).feed.count, JSON.parse(first.body).feed.count + 1)
  let unicode = await request(app.port, '/feed', { headers: { 'last-event-id': Buffer.from('雪').toString('latin1') } })
  assert.equal(JSON.parse(unicode.body).feed.id, '雪')
  assert.equal((await request(app.port, '/feed', { headers: { 'last-event-id': '\xff' } })).status, 400)
  assert.equal((await request(app.port, '/feed/action/ordinary', { headers: { 'last-event-id': '\xff' } })).status, 200)
  assert.equal((await request(app.port, '/feed', { headers: { 'x-cache': 'yes' } })).status, 500)
})

test('heartbeats continue during a pending pull; disconnect completes promptly and cancels once', async t => {
  let app = await fixture(t, files), connection = await open(app.port, '/feed', { headers: { ...sse, 'x-mode': 'pending' } })
  await until(() => Buffer.concat(connection.chunks).toString().includes(': heartbeat\n\n'))
  assert.equal(app.messages.filter(message => message.type === 'pull').length, 1)
  connection.call.destroy()
  await until(() => app.messages.some(message => message.type === 'end'))
  assert.equal(app.messages.find(message => message.type === 'end').outcome, 'cancelled')
  assert.equal(app.messages.find(message => message.type === 'end').aborted, true)
  assert.equal(app.messages.filter(message => message.type === 'dispose').length, 1)
  assert.equal(app.messages.filter(message => message.type === 'error').length, 0)
  assert.doesNotMatch(app.output, /200 GET.*feed/)
})

test('producer failure after commit aborts the transport without re-rendering or a success log', async t => {
  let app = await fixture(t, files), result = await request(app.port, '/feed', { headers: { ...sse, 'x-mode': 'failure' } })
  assert.equal(result.status, 200)
  assert.equal(result.aborted, true)
  assert.doesNotMatch(result.body, /stack|<html/)
  await until(() => app.messages.some(message => message.type === 'end'))
  assert.equal(app.messages.find(message => message.type === 'end').outcome, 'failed')
  assert.equal(app.messages.filter(message => message.type === 'error').length, 1)
  assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
})

test('declaring an endpoint bypasses existing request/action cache entries and inherited hook cache directives', async t => {
  let app = await fixture(t, {
    'app/controllers/routes/cached.js': `
      export const config = { controller: { contentTypes: ['application/json'], streaming: { enabled: false } } }
      let count = 0
      export const handler = () => ({ local: { count: ++count }, ...(config.controller.streaming.enabled ? {} : { cache: { action: { lifespan: 'application' } } }) })
      export const toggle = () => { config.controller.streaming.enabled = true; return { local: { enabled: true } } }
    `,
    'app/controllers/hooks/request.js': 'export const start = () => ({ cache: { request: { lifespan: \'application\' } } })'
  })
  let first = await request(app.port, '/cached'), cached = await request(app.port, '/cached')
  assert.equal(first.body, cached.body)
  await request(app.port, '/cached/action/toggle')
  let declared = await request(app.port, '/cached'), repeated = await request(app.port, '/cached')
  assert.equal(JSON.parse(declared.body).cached.count, 2)
  assert.equal(JSON.parse(repeated.body).cached.count, 3)
})

test('application-wide streaming supports streams, buffered fallbacks, and local opt-outs before hooks and cache lookup', async t => {
  let app = await fixture(t, {
    ...files,
    'app/controllers/routes/feed.js': routes.replace('controller: { streaming: { enabled: true },', 'controller: {'),
    'app/controllers/routes/disabled.js': `
      export const config = { controller: { streaming: { enabled: false }, contentTypes: ['application/json'] }, enabled: { streaming: { enabled: true } } }
      let count = 0
      export const handler = (params, request) => ({ local: { count: ++count, signal: !!request.signal }, ...(request.signal ? {} : { cache: { action: { lifespan: 'application' } } }) })
      export const enabled = handler
      export const reset = () => { delete config.controller.streaming; return { local: { reset: true } } }
    `,
    'app/controllers/hooks/request.js': `
      export const start = (params, request) => {
        process.send({ type: 'setup', url: request.url, signal: !!request.signal })
        return { cache: { request: { lifespan: 'application' } } }
      }
    `
  }, { streaming: { enabled: true } })
  let stream = await request(app.port, '/feed', { headers: sse })
  assert.equal(stream.status, 200)
  assert.match(stream.body, /event: progress\nid: 雪\ndata:/)
  for ( let [pathname, controller, enabled] of [
    ['/feed', 'feed', true],
    ['/feed/action/ordinary', 'feed', false],
    ['/disabled', 'disabled', false],
    ['/disabled/action/enabled', 'disabled', true]
  ] ) {
    let first = await request(app.port, pathname), second = await request(app.port, pathname)
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(JSON.parse(second.body)[controller].count, JSON.parse(first.body)[controller].count + (enabled ? 1 : 0))
    await until(() => app.messages.some(message => message.type === 'setup' && message.url === pathname))
    assert.equal(app.messages.find(message => message.type === 'setup' && message.url === pathname).signal, enabled)
  }
  // Removing an opt-out must bypass both caches populated while it was disabled.
  await request(app.port, '/disabled/action/reset')
  let first = await request(app.port, '/disabled'), second = await request(app.port, '/disabled')
  assert.equal(JSON.parse(first.body).disabled.signal, true)
  assert.equal(JSON.parse(second.body).disabled.count, JSON.parse(first.body).disabled.count + 1)
  for ( let action of ['invalid', 'ordinary', 'include', 'chain'] ) {
    let result = await request(app.port, '/feed/action/' + action, { headers: sse })
    assert.equal(result.status, 500, action)
  }
  assert.equal(app.messages.find(message => message.type === 'setup' && message.url === '/feed/action/invalid').signal, false)
  assert.equal(app.messages.filter(message => message.type === 'invalid-ran').length, 0)
  assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
})

test('include and next declarations use the application default without inheriting a preceding controller override', async t => {
  for ( let streaming of [false, true] ) {
    let app = await fixture(t, {
      'app/controllers/routes/parent.js': `
        export const config = { controller: { streaming: { enabled: ${!streaming} } } }
        export const handler = () => ({ local: {}, next: { controller: 'child' } })
        export const include = () => ({ local: {}, include: { child: '/child' } })
      `,
      'app/controllers/routes/child.js': `
        export const handler = () => ({ local: { child: true }, cache: { action: { lifespan: 'application' } } })
      `
    }, { streaming: { enabled: streaming }, contentTypes: ['application/json'] })
    for ( let pathname of ['/parent', '/parent/action/include'] ) {
      let result = await request(app.port, pathname)
      assert.equal(result.status, streaming ? 500 : 200, result.body)
      assert.match(result.body, streaming ? /Declared streaming actions cannot return cache directives/ : /"child":true/)
    }
    assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
  }
})

test('SSE defaults reach the wire with controller, action, and descriptor overrides', async t => {
  let app = await fixture(t, {
    'app/controllers/routes/events.js': `
      import { setTimeout as delay } from 'node:timers/promises'
      export const config = {
        controller: { streaming: { sse: { retry: 800 } } },
        fast: { streaming: { sse: { heartbeat: 10 } } },
        quiet: { streaming: { sse: { heartbeat: false, retry: false } } },
        zero: { streaming: { sse: { retry: 0 } } },
        invalid: { streaming: { sse: { heartbeat: 0 } } },
        raw: { contentTypes: ['text/plain'] }
      }
      export const handler = (params, request) => ({ stream: {
        format: 'sse',
        ...(request.headers['x-override'] ? { heartbeat: false, retry: false } : {}),
        source: (async function* () { await delay(80); yield { data: 'done' } })()
      } })
      export const fast = handler
      export const quiet = handler
      export const zero = handler
      export const invalid = () => { process.send({ type: 'invalid-ran' }); return {} }
      export const raw = () => (async function* () { await delay(80); yield 'raw' })()
    `,
    'app/controllers/routes/global.js': 'export { handler } from \'./events.js\'',
    'app/controllers/hooks/request.js': 'export const start = (params, request) => process.send({ type: "setup", url: request.url, signal: !!request.signal })'
  }, { streaming: { enabled: true, sse: { heartbeat: 25, retry: 900 } }, contentTypes: ['text/event-stream'] })
  for ( let [pathname, retry, heartbeat, headers] of [
    ['/global', 900, true], ['/events', 800, true], ['/events/action/fast', 800, true],
    ['/events/action/quiet', false, false], ['/events/action/zero', 0, true],
    ['/events', false, false, { 'x-override': 'yes' }]
  ] ) {
    let result = await request(app.port, pathname, { headers })
    assert.equal(result.status, 200, result.body)
    if ( retry === false ) {
      assert.doesNotMatch(result.body, /retry:/)
    } else {
      assert.ok(result.body.startsWith('retry: ' + retry + '\n\n'), result.body)
    }
    assert.equal(result.body.includes(': heartbeat\n\n'), heartbeat, result.body)
    assert.ok(result.body.endsWith('data: done\n\n'))
  }
  let raw = await request(app.port, '/events/action/raw')
  assert.equal(raw.status, 200)
  assert.equal(raw.body, 'raw')
  let invalid = await request(app.port, '/events/action/invalid')
  assert.equal(invalid.status, 500)
  assert.match(invalid.body, /SSE heartbeat/)
  assert.equal(app.messages.find(message => message.type === 'setup' && message.url === '/events/action/invalid').signal, false)
  assert.equal(app.messages.filter(message => message.type === 'invalid-ran').length, 0)
  assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
})
