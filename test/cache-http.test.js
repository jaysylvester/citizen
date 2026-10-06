import assert        from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once }      from 'node:events'
import fs            from 'node:fs'
import http          from 'node:http'
import net           from 'node:net'
import os            from 'node:os'
import path          from 'node:path'
import test          from 'node:test'
import { fileURLToPath } from 'node:url'


const projectPath = fileURLToPath(new URL('..', import.meta.url)),
      lastModified = '2020-01-02T03:04:05.000Z'


function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    let call = http.get({
      hostname: '127.0.0.1',
      port: port,
      path: pathname,
      headers: { accept: 'application/json', ...headers }
    }, response => {
      let body = ''

      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: body }))
    })

    call.on('error', reject)
    call.setTimeout(5000, () => call.destroy(new Error('HTTP request timed out')))
  })
}


function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '',
        timer = setTimeout(() => finish(new Error('Server did not start:\n' + output)), 5000),
        data = chunk => {
          output += chunk
          if ( output.includes('HTTP server started') ) {
            finish()
          }
        },
        exited = code => finish(new Error('Server exited with code ' + code + ':\n' + output)),
        finish = err => {
          clearTimeout(timer)
          child.stdout.off('data', data)
          child.stderr.off('data', data)
          child.off('exit', exited)
          if ( err ) {
            reject(err)
          } else {
            resolve()
          }
        }

    child.stdout.on('data', data)
    child.stderr.on('data', data)
    child.once('exit', exited)
  })
}


async function fixture(context, errors = 'capture', yieldErrorHook = false, options = {}) {
  let listener = net.createServer()

  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  let port = listener.address().port

  listener.close()
  await once(listener, 'close')

  let root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'citizen-cache-http-'))),
      env = { ...process.env, NODE_ENV: 'production' },
      child

  delete env.CITIZEN_APP_PATH
  context.after(async () => {
    if ( child && child.exitCode === null && child.signalCode === null ) {
      let exited = once(child, 'exit')

      child.kill()
      await exited
    }
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"cache-fixture","private":true,"type":"module"}\n')
  let scaffold = spawnSync(process.execPath, [path.join(projectPath, 'util/scaffold.js'), 'skeleton', '--mode', 'production'], {
    cwd: root,
    env: env,
    encoding: 'utf8'
  })

  assert.equal(scaffold.status, 0, scaffold.stderr)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(projectPath, path.join(root, 'node_modules/citizen'), 'dir')
  fs.writeFileSync(path.join(root, 'citizen.config.js'), `
    export default {
      citizen: {
        mode: 'production',
        errors: ${JSON.stringify(errors)},
        http: { port: ${port} },
        sessions: { enabled: ${Boolean(options.sessions)} },
        cache: {
          application: { lifespan: 5, resetOnAccess: true },
          static: { enabled: true, lifespan: 13, resetOnAccess: false }
        },
        logs: { access: false, error: false, debug: false, maxFileSize: 0 }
      }
    }
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/hooks/application.js'), `
    export const error = async () => {
      app.errorReports++
      ${yieldErrorHook ? 'await new Promise(resolve => setImmediate(resolve))' : ''}
    }
  `)
  let hookDirectives = `
    const directives = (request, hook) => {
      if ( request.headers['x-fixture-hook'] !== hook ) return {}
      let value = request.headers['x-fixture-hook-value'] || 'cold',
          mode = request.headers['x-fixture-redirect'],
          status = Number(request.headers['x-fixture-redirect-status']) || 302
      return {
        header: { 'X-Hook-Value': value, 'x-HOOK-conflict': value, 'Set-Cookie': 'headerOnly=' + value },
        cookie: { hookCookie: value },
        session: { hookValue: value },
        ...(mode ? { redirect: mode === 'refresh'
          ? { url: '/destination', refresh: 0, statusCode: status }
          : status === 302 ? '/destination' : { url: '/destination', statusCode: status } } : {})
      }
    }
  `
  fs.writeFileSync(path.join(root, 'app/controllers/hooks/request.js'), `
    ${hookDirectives}
    export const start = async (params, request) => {
      let id = request.headers['x-fixture-request-id']
      return {
        ...directives(request, 'request.start'),
        requestInfo: { id: id || 'none' },
        ...(request.headers['x-fixture-cache-request'] ? { cache: { request: { lifespan: 'application', lastModified: '${lastModified}' } } } : {}),
        ...(id ? { header: {
        'X-Request-ID': id,
        'Set-Cookie': 'current=' + id + '; Path=/',
        'Content-Security-Policy': "script-src 'nonce-" + id + "'",
        'Access-Control-Allow-Origin': 'https://' + id + '.example.test'
        } } : {})
      }
    }
    export const end = async (params, request) => directives(request, 'request.end')
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/hooks/response.js'), `
    ${hookDirectives}
    export const start = async (params, request) => directives(request, 'response.start')
    export const end = async params => {
      app.hookResponses++
      app.hookSession = params.session.hookValue || null
      app.chain = Object.entries(params.route.chain).map(([name, link]) => ({
        name, controller: link.controller, action: link.action,
        pathname: link.params?.route.pathname
      }))
    }
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/hooks/session.js'), `
    ${hookDirectives}
    export const start = async (params, request) => directives(request, 'session.start')
  `)
  let directiveHeaders = {
    'cAcHe-CoNtRoL': 'public, max-age=60',
    'Content-Language': 'en',
    'Content-Disposition': 'inline',
    'Last-Modified': 'Thu, 02 Jan 2020 03:04:05 GMT',
    'Link': ['</asset.txt>; rel=preload', '</other.txt>; rel=alternate'],
    'Vary': 'Accept, Accept-Encoding',
    'Date': 'Thu, 02 Jan 2020 03:04:05 GMT',
    'Set-Cookie': 'controller=first; Path=/',
    'Content-Security-Policy': 'script-src \'nonce-controller\'',
    'Access-Control-Allow-Origin': 'https://controller.example.test',
    'X-Controller-Token': 'controller-only',
    'X-Cache-Tag': ['article', 'layout'],
    'Connection': 'close',
    'Content-Type': 'application/json',
    'Content-Encoding': 'identity',
    'ETag': 'controller-tag'
  }
  let routes = {
    request: `({ request: { lastModified: '${lastModified}', lifespan: 3, resetOnAccess: false, urlParams: [] } })`,
    actioncache: '({ action: { lifespan: 3, resetOnAccess: false, urlParams: [] } })',
    hookaction: '({ action: { lifespan: \'application\' } })',
    hookrequest: `({ request: { lifespan: 'application', lastModified: '${lastModified}', resetOnAccess: false } })`,
    sentinel: '({ request: { lifespan: \'application\', resetOnAccess: false } })',
    queries: '({ request: { lifespan: \'application\', resetOnAccess: false } })',
    headerreplay: `({ request: { lifespan: 'application', lastModified: '${lastModified}' } })`,
    headerboth: `({ action: { lifespan: 'application' }, request: { lifespan: 'application', lastModified: '${lastModified}' } })`,
    chained: `({ request: { lastModified: '${lastModified}', lifespan: 'application' } })`,
    both: `({ action: { lifespan: 'application' }, request: { lastModified: '${lastModified}', lifespan: 'application' } })`,
    override: `({ request: { lastModified: '${lastModified}', lifespan: 'application' } })`
  }

  for ( let [name, directive] of Object.entries(routes) ) {
    fs.writeFileSync(path.join(root, 'app/controllers/routes', name + '.js'), `
      let calls = 0
      export const handler = async (params, request, response) => {
        ${name.startsWith('header') ? 'response.setHeader(\'X-Direct-Only\', \'uncached\')' : ''}
        return {
        cache: ${directive},
        local: { calls: ++calls${name === 'queries' ? ', url: params.route.url' : ''} },
        ${name === 'chained' ? 'next: \'/_layout\',' : ''}
        ${name === 'override' ? 'header: { ETag: \'controller-tag\' },' : ''}
        ${name === 'hookrequest' ? 'header: { \'X-Hook-Conflict\': \'controller\' },' : ''}
        ${name.startsWith('header') ? 'header: ' + JSON.stringify(directiveHeaders) + ',' : ''}
        }
      }
    `)
    fs.writeFileSync(path.join(root, 'app/views', name + '.html'), name + ':${local.calls}')
  }
  for ( let kind of ['request', 'action'] ) {
    fs.writeFileSync(path.join(root, 'app/controllers/routes', 'retention' + kind + '.js'), `
      export const handler = async (params, request) => {
        app.counts.retention${kind}++
        let id = request.headers['x-fixture-fill-id'] || 'refill',
            validator = id === 'first' ? '${lastModified}' : '2021-01-02T03:04:05.000Z'
        if ( request.headers['x-fixture-fill-id'] ) {
          await new Promise(resolve => {
            app.pendingFills[id] = resolve
            process.send({ waiting: id })
          })
        }
        return {
          cache: { ${kind}: { lifespan: ${kind === 'request' ? 3 : '\'application\''}, resetOnAccess: false, lastModified: validator } },
          local: { id }, header: { 'X-Fill': id, ETag: validator }
        }
      }
    `)
  }
  fs.writeFileSync(path.join(root, 'app/controllers/routes/_layout.js'), 'export const handler = async () => ({ local: { layout: true } })\n')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/headerchain.js'), `
    let calls = 0
    export const handler = async () => ({
      cache: { request: { lifespan: 'application' } },
      local: { calls: ++calls },
      header: { 'Cache-Control': 'public, max-age=60', 'Content-Language': 'en', Link: '</first>; rel=preload' },
      next: '/_headerlayout'
    })
  `)
  fs.writeFileSync(path.join(root, 'app/views/headerchain.html'), 'headerchain:${local.calls}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/_headerlayout.js'), `
    export const handler = async () => ({
      local: { layout: true },
      header: { 'cache-control': 'public, max-age=30', 'CONTENT-LANGUAGE': 'fr', LINK: ['</final>; rel=preload', '</other>; rel=alternate'] }
    })
  `)
  fs.writeFileSync(path.join(root, 'app/views/_headerlayout.html'), 'header-layout')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/replay.js'), `
    export const handler = async () => ({
      cache: { action: { lifespan: 3 } },
      local: { calls: ++app.counts.action },
      next: '/replaytail',
      include: { piece: '/replayinclude' },
      custom: { message: 'from-action', touched: [] },
      cookie: { actionCookie: 'stored' },
      session: { actionSession: 'stored' },
      header: { 'X-Action': 'action', 'Cache-Control': 'public, max-age=60', ETag: 'action-validator' }
    })
  `)
  fs.writeFileSync(path.join(root, 'app/views/replay.html'), 'action:${local.calls}:${include.piece}:${++app.counts.actionView}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/replayinclude.js'), `
    export const handler = async () => ({ local: { calls: ++app.counts.include } })
  `)
  fs.writeFileSync(path.join(root, 'app/views/replayinclude.html'), 'include:${local.calls}:${++app.counts.includeView}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/replaytail.js'), `
    export const handler = async (params, request, response, context) => {
      app.counts.tail++
      context.custom.touched.push('tail')
      return {
        local: {
          message: context.custom.message,
          session: params.session.actionSession,
          fresh: context.requestInfo.id,
          inheritedHeader: context.header || null,
          inheritedCache: context.cache || null
        },
        header: { 'X-Action': 'tail', 'X-Tail': 'live', 'Cache-Control': 'public, max-age=30', ETag: 'tail-validator' }
      }
    }
  `)
  fs.writeFileSync(path.join(root, 'app/views/replaytail.html'), 'tail:${local.message}:${local.session}:${local.fresh}:${local.inheritedHeader}:${local.inheritedCache}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/sessionreset.js'), `
    export const handler = async params => {
      delete CTZN.sessions[params.session.ctzn_session_id].app.actionSession
      return { local: { cleared: true } }
    }
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/routes/jsonreplay.js'), `
    export const handler = async () => ({
      cache: { action: { lifespan: 'application' } },
      local: { stable: true }, custom: { message: 'json-context' }, next: '/jsonmiddle',
      include: { piece: '/cachedinclude', fresh: '/replayinclude' }
    })
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/routes/jsonmiddle.js'), `
    export const handler = async () => ({
      cache: { action: { lifespan: 'application' } },
      local: { calls: ++app.counts.middle }, next: '/jsonend', header: { 'X-Middle': 'cached' }
    })
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/routes/jsonend.js'), `
    export const handler = async (params, request, response, context) => ({ local: { message: context.custom.message } })
  `)
  fs.writeFileSync(path.join(root, 'app/controllers/routes/includeparent.js'), `
    export const handler = async () => ({ local: { parent: true }, include: { piece: '/cachedinclude' } })
  `)
  fs.writeFileSync(path.join(root, 'app/views/includeparent.html'), 'parent:${include.piece}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/cachedinclude.js'), `
    export const handler = async () => ({
      cache: { action: { lifespan: 'application' } },
      local: { fromInclude: 'yes', calls: ++app.counts.cachedInclude },
      header: { 'X-Include': 'ignored' }, cookie: { includeCookie: 'ignored' },
      next: '/failure', redirect: '/destination'
    })
  `)
  fs.writeFileSync(path.join(root, 'app/views/cachedinclude.html'), 'cached-include:${local.calls}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/refreshreplay.js'), `
    export const handler = async () => ({
      cache: { action: { lifespan: 'application' } },
      local: { calls: ++app.counts.refresh }, redirect: { url: '/destination', refresh: 0 }
    })
  `)
  fs.writeFileSync(path.join(root, 'app/views/refreshreplay.html'), 'refresh:${local.calls}:${++app.counts.refreshView}')
  fs.writeFileSync(path.join(root, 'app/controllers/routes/failure.js'), 'export const handler = async () => { throw new Error(\'Expected fixture error\') }\n')
  fs.writeFileSync(path.join(root, 'web/asset.txt'), 'static-content')
  fs.writeFileSync(path.join(root, 'app/start.js'), `
    import citizen from 'citizen'
    global.app = citizen
    app.errorReports = 0
    app.hookResponses = 0
    app.hookSession = null
    app.counts = { action: 0, actionView: 0, include: 0, includeView: 0, tail: 0, middle: 0, cachedInclude: 0, refresh: 0, refreshView: 0, retentionrequest: 0, retentionaction: 0 }
    app.pendingFills = {}
    process.on('message', message => {
      if (message.releaseFill) {
        app.pendingFills[message.releaseFill]()
        delete app.pendingFills[message.releaseFill]
        return
      }
      if (message.clear) app.cache.clear(message.clear)
      let entries = {}, headers = {}, stored = {}, accessed = {}
      for (let [route, types] of Object.entries(CTZN.cache.routes || {})) {
        entries[route] = {}
        for (let [type, entry] of Object.entries(types)) {
          entries[route][type] = {
            lifespan: entry.lifespan,
            resetOnAccess: entry.resetOnAccess,
            timer: Boolean(entry.timer)
          }
          headers[route] = headers[route] || {}
          headers[route][type] = entry.context.header
          stored[route] = stored[route] || {}
          stored[route][type] = {
            context: entry.context, output: entry.output, lastModified: entry.lastModified,
            controller: entry.controller, action: entry.action, params: entry.params
          }
          accessed[route] = accessed[route] || {}
          accessed[route][type] = entry.lastAccessed
        }
      }
      process.send({ entries, headers, stored, accessed, counts: app.counts, chain: app.chain, hookResponses: app.hookResponses, hookSession: app.hookSession, errorReports: app.errorReports, staticReset: CTZN.cache.files?.[${JSON.stringify(path.join(root, 'web/asset.txt'))}]?.resetOnAccess })
    })
    app.start()
  `)
  child = spawn(process.execPath, ['app/start.js'], { cwd: root, env: env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  await waitForServer(child)

  return {
    child: child,
    port: port,
    url: 'http://127.0.0.1:' + port,
    snapshot: async clear => {
      let reply = once(child, 'message')

      child.send({ clear: clear })
      return (await reply)[0]
    }
  }
}


test('HTTP cache fixes preserve directive options, validators, and rendering', { timeout: 30000 }, async context => {
  let server = await fixture(context)

  for ( let kind of ['request', 'action'] ) {
    await context.test(kind + ' cache retains the first completed cold fill', async () => {
      let pathname = '/retention' + kind,
          key = kind === 'request' ? server.url + pathname : pathname,
          waiting = once(server.child, 'message'),
          duplicateRequest = request(server.port, pathname, { 'x-fixture-fill-id': 'duplicate' })

      assert.deepEqual((await waiting)[0], { waiting: 'duplicate' })
      waiting = once(server.child, 'message')
      let firstRequest = request(server.port, pathname, { 'x-fixture-fill-id': 'first' })

      assert.deepEqual((await waiting)[0], { waiting: 'first' })
      // The request that started second finishes first and wins insertion.
      server.child.send({ releaseFill: 'first' })
      let first = await firstRequest,
          published = await server.snapshot()

      assert.equal(first.status, 200)
      assert.equal(first.headers['x-fill'], 'first')
      assert.equal(published.stored[key]['application/json'].lastModified, lastModified)
      server.child.send({ releaseFill: 'duplicate' })
      let duplicate = await duplicateRequest,
          hit = await request(server.port, pathname),
          retained = await server.snapshot()

      // Both cold requests render independently; subsequent requests reuse the winner.
      assert.equal(duplicate.status, 200)
      assert.equal(duplicate.headers['x-fill'], 'duplicate')
      assert.notEqual(duplicate.body, first.body)
      assert.equal(hit.status, 200)
      assert.equal(hit.body, first.body)
      assert.equal(hit.headers['x-fill'], 'first')
      assert.equal(hit.headers.etag, first.headers.etag)
      assert.deepEqual(retained.stored[key], published.stored[key])
      assert.deepEqual(retained.entries[key], published.entries[key])
      assert.equal(retained.counts['retention' + kind], 2)

      await server.snapshot({ route: key })
      let refill = await request(server.port, pathname)

      assert.equal(refill.status, 200)
      assert.equal(refill.headers['x-fill'], 'refill')
      assert.notEqual(refill.body, first.body)
      assert.equal((await server.snapshot()).counts['retention' + kind], 3)
      assert.equal((await request(server.port, pathname)).body, refill.body)
    })
  }

  await context.test('request and action insertions retain explicit false and lifespans', async () => {
    for ( let pathname of ['/request', '/actioncache', '/sentinel'] ) {
      let first = await request(server.port, pathname),
          second = await request(server.port, pathname)

      assert.equal(first.status, 200)
      assert.equal(second.body, first.body)
    }
    let state = await server.snapshot()

    assert.deepEqual(state.entries[server.url + '/request']['application/json'], { lifespan: 180000, resetOnAccess: false, timer: true })
    assert.deepEqual(state.entries['/actioncache']['application/json'], { lifespan: 180000, resetOnAccess: false, timer: true })
    assert.deepEqual(state.entries[server.url + '/sentinel']['application/json'], { lifespan: 'application', resetOnAccess: false, timer: false })
    let asset = await request(server.port, '/asset.txt')

    assert.equal(asset.status, 200)
    assert.equal(asset.body, 'static-content')
    assert.equal((await server.snapshot()).staticReset, false)
  })

  await context.test('explicit request validators survive controller chaining and cache hits', async () => {
    for ( let pathname of ['/request', '/chained'] ) {
      await server.snapshot({ route: server.url + pathname })
      let first = await request(server.port, pathname),
          second = await request(server.port, pathname),
          conditional = await request(server.port, pathname, { 'if-none-match': first.headers.etag })

      assert.equal(first.headers.etag, lastModified)
      assert.equal(second.headers.etag, lastModified)
      assert.equal(second.body, first.body)
      assert.equal(conditional.status, 304)
      assert.equal(conditional.body, '')
    }
    assert.equal((await request(server.port, '/override')).headers.etag, 'controller-tag')
  })

  await context.test('request-cache lookups reuse full URLs and isolate query strings', async () => {
    let paths = ['/queries', '/queries?variant=a', '/queries?variant=b', '/queries?variant=a&variant=b&label=two%20words'],
        responses = new Map()

    for ( let [index, pathname] of paths.entries() ) {
      let first = await request(server.port, pathname),
          second = await request(server.port, pathname)

      assert.equal(first.status, 200)
      assert.deepEqual(JSON.parse(first.body), { queries: { calls: index + 1, url: server.url + pathname } })
      assert.equal(second.body, first.body)
      responses.set(pathname, first.body)
    }
    for ( let pathname of paths ) {
      assert.equal((await request(server.port, pathname)).body, responses.get(pathname))
    }
    let state = await server.snapshot()

    for ( let pathname of paths ) {
      assert.deepEqual(state.entries[server.url + pathname]['application/json'], { lifespan: 'application', resetOnAccess: false, timer: false })
    }
    await server.snapshot({ route: server.url + paths[1] })
    assert.deepEqual(JSON.parse((await request(server.port, paths[1])).body), { queries: { calls: paths.length + 1, url: server.url + paths[1] } })
    assert.equal((await request(server.port, paths[2])).body, responses.get(paths[2]))
    assert.equal((await request(server.port, paths[0])).body, responses.get(paths[0]))
  })

  await context.test('a warm action supplies an explicit validator while refilling the request cache', async () => {
    let first = await request(server.port, '/both')

    await server.snapshot({ route: server.url + '/both' })
    let warmed = await request(server.port, '/both')

    assert.equal(first.headers.etag, lastModified)
    assert.equal(warmed.headers.etag, lastModified)
    assert.equal(warmed.body, first.body)
  })

  await context.test('request-cache hits replay directive headers without filtering on 200 and 304 responses', async () => {
    let first = await request(server.port, '/headerreplay', { 'x-fixture-request-id': 'first' }),
        second = await request(server.port, '/headerreplay', { 'x-fixture-request-id': 'second' }),
        conditional = await request(server.port, '/headerreplay', { 'x-fixture-request-id': 'third', 'if-none-match': lastModified })

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(second.body, first.body)
    for ( let name of ['cache-control', 'content-language', 'content-disposition', 'last-modified', 'link', 'vary', 'set-cookie', 'content-security-policy', 'access-control-allow-origin', 'x-controller-token', 'x-cache-tag', 'connection'] ) {
      assert.ok(first.headers[name])
      assert.deepEqual(second.headers[name], first.headers[name])
      assert.deepEqual(conditional.headers[name], first.headers[name])
    }
    assert.equal(second.headers.date, first.headers.date)
    for ( let [id, response] of [['second', second], ['third', conditional]] ) {
      assert.equal(response.headers['x-request-id'], id)
      assert.equal(response.headers['x-direct-only'], undefined)
      assert.equal(response.headers.etag, lastModified)
    }
    assert.equal(first.headers['x-direct-only'], 'uncached')
    assert.equal(conditional.status, 304)
    assert.equal(conditional.body, '')
    let state = await server.snapshot(),
        headers = state.headers[server.url + '/headerreplay']['application/json']

    assert.deepEqual(headers.link, ['</asset.txt>; rel=preload', '</other.txt>; rel=alternate'])
    assert.deepEqual(headers['x-cache-tag'], ['article', 'layout'])
    assert.equal(headers['set-cookie'], 'controller=first; Path=/')
    assert.equal(headers['x-controller-token'], 'controller-only')
    assert.equal(headers['x-request-id'], undefined)
    assert.equal(headers['x-direct-only'], undefined)
  })

  await context.test('header replay preserves final controller-chain values and case-insensitive overrides', async () => {
    for ( let accept of ['application/json', 'text/html'] ) {
      let first = await request(server.port, '/headerchain', { accept: accept }),
          second = await request(server.port, '/headerchain', { accept: accept })

      assert.equal(first.status, 200)
      assert.equal(second.body, first.body)
      for ( let response of [first, second] ) {
        assert.equal(response.headers['cache-control'], 'public, max-age=30')
        assert.equal(response.headers['content-language'], 'fr')
        assert.equal(response.headers.link, '</final>; rel=preload, </other>; rel=alternate')
      }
    }
  })

  await context.test('cached actions replay all directive headers while refilling the request cache', async () => {
    let first = await request(server.port, '/headerboth', { 'x-fixture-request-id': 'first' })

    await server.snapshot({ route: server.url + '/headerboth' })
    let warmed = await request(server.port, '/headerboth', { 'x-fixture-request-id': 'second' }),
        hit = await request(server.port, '/headerboth', { 'x-fixture-request-id': 'third' })

    for ( let [id, response] of [['second', warmed], ['third', hit]] ) {
      assert.equal(response.status, 200)
      assert.equal(response.body, first.body)
      for ( let name of ['cache-control', 'link', 'set-cookie', 'content-security-policy', 'access-control-allow-origin', 'x-controller-token', 'x-cache-tag'] ) {
        assert.deepEqual(response.headers[name], first.headers[name])
      }
      assert.equal(response.headers['x-request-id'], id)
      assert.equal(response.headers['x-direct-only'], undefined)
    }
  })

  await context.test('hook request-cache directives apply to a warm action without changing its stored context', async () => {
    let first = await request(server.port, '/hookaction'),
        before = await server.snapshot(),
        warmed = await request(server.port, '/hookaction', { 'x-fixture-cache-request': 'yes', 'x-fixture-request-id': 'warm' }),
        hit = await request(server.port, '/hookaction', { 'x-fixture-request-id': 'hit' }),
        after = await server.snapshot()

    assert.equal(warmed.body, first.body)
    assert.equal(hit.body, first.body)
    assert.equal(warmed.headers.etag, lastModified)
    assert.equal(hit.headers.etag, lastModified)
    assert.equal(hit.headers['x-request-id'], 'hit')
    assert.deepEqual(after.stored['/hookaction'], before.stored['/hookaction'])
    assert.equal(after.stored['/hookaction']['application/json'].context.cache.request, undefined)
    await server.snapshot({ route: server.url + '/hookaction' })
    assert.equal((await request(server.port, '/hookaction')).body, first.body)
    assert.equal((await server.snapshot()).entries[server.url + '/hookaction'], undefined)
  })

  await context.test('cached includes retain local data in JSON and JSONP without replaying directives', async () => {
    for ( let [pathname, accept] of [['/includeparent', 'application/json'], ['/includeparent/callback/show', 'application/javascript']] ) {
      let before = await server.snapshot(),
          first = await request(server.port, pathname, { accept }),
          second = await request(server.port, pathname, { accept }),
          third = await request(server.port, pathname, { accept }),
          after = await server.snapshot(),
          json = accept === 'application/json' ? first.body : first.body.slice('show('.length, -2)

      assert.equal(first.status, 200)
      assert.deepEqual(JSON.parse(json), { includeparent: { parent: true, include: { piece: { fromInclude: 'yes', calls: before.counts.cachedInclude + 1 } } } })
      assert.equal(second.body, first.body)
      assert.equal(third.body, first.body)
      assert.equal(after.counts.cachedInclude, before.counts.cachedInclude + 1)
      for ( let response of [first, second, third] ) {
        assert.equal(response.headers['x-include'], undefined)
        assert.equal(response.headers['set-cookie'], undefined)
        assert.equal(response.headers.location, undefined)
      }
    }
  })

  await context.test('an include-cached action replays a server redirect when called as a route', async () => {
    let parent = await request(server.port, '/includeparent', { accept: 'text/html' }),
        before = await server.snapshot(),
        direct = await request(server.port, '/cachedinclude', { accept: 'text/html' }),
        after = await server.snapshot()

    assert.equal(parent.status, 200)
    assert.equal(parent.headers.location, undefined)
    assert.equal(parent.headers['x-include'], undefined)
    assert.equal(direct.status, 302)
    assert.equal(direct.headers.location, '/destination')
    assert.equal(direct.headers['x-include'], 'ignored')
    assert.ok(direct.headers['set-cookie'].some(value => value.startsWith('includeCookie=ignored;')))
    assert.equal(direct.body, '')
    assert.equal(after.counts.cachedInclude, before.counts.cachedInclude)
    assert.deepEqual(after.stored['/cachedinclude'], before.stored['/cachedinclude'])
  })

  await context.test('invalid parameters report errors while bypassing action and request insertion', async () => {
    for ( let pathname of ['/actioncache/item/unlisted/1', '/request/item/unlisted/1'] ) {
      for ( let accept of ['application/json', 'text/html'] ) {
        let before = await server.snapshot(),
            first = await request(server.port, pathname, { accept: accept }),
            second = await request(server.port, pathname, { accept: accept }),
            after = await server.snapshot()

        assert.equal(first.status, 200)
        assert.equal(second.status, 200)
        assert.ok(first.body.length > 0)
        assert.notEqual(second.body, first.body)
        assert.equal(after.entries[pathname], undefined)
        assert.equal(after.entries[server.url + pathname], undefined)
        assert.equal(after.errorReports - before.errorReports, 2)
      }
    }
  })

  await context.test('ordinary controller errors still return 500 under capture', async () => {
    assert.equal((await request(server.port, '/failure')).status, 500)
  })
})


test('HTTP request-cache hits apply live hook headers and redirects', { timeout: 30000 }, async context => {
  let server = await fixture(context, 'capture', false, { sessions: true }),
      live = (response, state, value) => {
        assert.equal(response.headers['x-hook-value'], value)
        assert.equal(response.headers['x-hook-conflict'], 'controller')
        assert.ok(response.headers['set-cookie'].some(cookie => cookie.startsWith('hookCookie=' + value + ';')))
        assert.ok(response.headers['set-cookie'].some(cookie => cookie.startsWith('ctzn_session_id=')))
        assert.ok(response.headers['set-cookie'].every(cookie => !cookie.startsWith('headerOnly=')))
        assert.equal(state.hookSession, value)
      }

  for ( let hook of ['session.start', 'request.end', 'response.start'] ) {
    let headers = { accept: 'text/html', 'x-fixture-hook': hook }

    await context.test(hook + ' headers remain live on 200 and 304 responses', async () => {
      let pathname = '/hookrequest?headers=' + hook,
          first = await request(server.port, pathname, headers),
          before = await server.snapshot(),
          key = server.url + pathname

      assert.equal(first.status, 200)
      live(first, before, 'cold')
      assert.equal(before.headers[key]['text/html']['x-hook-value'], undefined)
      for ( let conditional of [false, true] ) {
        let value = conditional ? 'conditional' : 'warm',
            response = await request(server.port, pathname, {
              ...headers, 'x-fixture-hook-value': value,
              ...(conditional ? { 'if-none-match': first.headers.etag } : {})
            }),
            state = await server.snapshot()

        assert.equal(response.status, conditional ? 304 : 200)
        assert.equal(response.body, conditional ? '' : first.body)
        live(response, state, value)
        assert.deepEqual(state.stored[key], before.stored[key])
      }
      // Without a session cookie, every hit above starts a new session.
      // An existing session must not invoke session.start again.
      if ( hook === 'session.start' ) {
        let cookie = first.headers['set-cookie'].find(cookie => cookie.startsWith('ctzn_session_id=')).split(';')[0],
            response = await request(server.port, pathname, { ...headers, cookie, 'x-fixture-hook-value': 'existing' })

        assert.equal(response.status, 200)
        assert.equal(response.headers['x-hook-value'], undefined)
        assert.equal((await server.snapshot()).hookSession, 'cold')
      }
    })

    await context.test(hook + ' server redirects precede cached bodies and conditional responses', async () => {
      for ( let status of [302, 307] ) {
        let redirectHeaders = { ...headers, 'x-fixture-redirect': 'server', 'x-fixture-redirect-status': String(status) },
            cold = await request(server.port, '/hookrequest?coldRedirect=' + hook + '&status=' + status, redirectHeaders),
            pathname = '/hookrequest?warmRedirect=' + hook + '&status=' + status

        assert.equal(cold.status, status)
        assert.equal(cold.headers.location, '/destination')
        assert.equal(cold.body, '')
        let first = await request(server.port, pathname, headers),
            before = await server.snapshot(),
            key = server.url + pathname

        for ( let conditional of [false, true] ) {
          let value = conditional ? 'conditional' : 'warm',
              previous = await server.snapshot(),
              response = await request(server.port, pathname, {
                ...redirectHeaders, 'x-fixture-hook-value': value,
                ...(conditional ? { 'if-none-match': first.headers.etag } : {})
              }),
              state = await server.snapshot()

          assert.equal(response.status, status)
          assert.equal(response.headers.location, '/destination')
          assert.equal(response.body, '')
          live(response, state, value)
          assert.equal(state.hookResponses, previous.hookResponses + 1)
          assert.deepEqual(state.stored[key], before.stored[key])
        }
      }
    })

    await context.test(hook + ' refresh redirects retain their status and cached body with matching validators', async () => {
      for ( let status of [302, 200] ) {
        let pathname = '/hookrequest?refresh=' + hook + '&status=' + status,
            redirectHeaders = { ...headers, 'x-fixture-redirect': 'refresh', 'x-fixture-redirect-status': String(status) },
            first = await request(server.port, pathname, redirectHeaders),
            before = await server.snapshot(),
            key = server.url + pathname

        assert.equal(first.status, status)
        assert.equal(first.headers.refresh, '0;url=/destination')
        assert.ok(first.body.length > 0)
        for ( let conditional of [false, true] ) {
          let value = conditional ? 'conditional' : 'warm',
              previous = await server.snapshot(),
              response = await request(server.port, pathname, {
                ...redirectHeaders, 'x-fixture-hook-value': value,
                ...(conditional ? { 'if-none-match': first.headers.etag } : {})
              }),
              state = await server.snapshot()

          assert.equal(response.status, status)
          assert.equal(response.headers.refresh, '0;url=/destination')
          assert.equal(response.body, first.body)
          live(response, state, value)
          assert.equal(state.hookResponses, previous.hookResponses + 1)
          assert.deepEqual(state.stored[key], before.stored[key])
        }
        let ordinary = await request(server.port, pathname, { accept: 'text/html' })

        assert.equal(ordinary.status, 200)
        assert.equal(ordinary.headers.refresh, undefined)
        assert.equal(ordinary.headers['x-hook-value'], undefined)
        assert.equal(ordinary.body, first.body)
      }
    })
  }

  await context.test('request.start headers and redirects keep their existing handling', async () => {
    let pathname = '/hookrequest?start=1',
        headers = { accept: 'text/html', 'x-fixture-hook': 'request.start' },
        first = await request(server.port, pathname, headers),
        conditional = await request(server.port, pathname, { ...headers, 'x-fixture-hook-value': 'live', 'if-none-match': first.headers.etag })

    assert.equal(conditional.status, 304)
    live(conditional, await server.snapshot(), 'live')
    let before = await server.snapshot(),
        redirected = await request(server.port, pathname, { ...headers, 'x-fixture-hook-value': 'redirect', 'x-fixture-redirect': 'server', 'if-none-match': first.headers.etag }),
        state = await server.snapshot()

    assert.equal(redirected.status, 302)
    assert.equal(redirected.headers.location, '/destination')
    assert.equal(redirected.headers['x-hook-value'], 'redirect')
    assert.equal(redirected.body, '')
    assert.equal(state.hookResponses, before.hookResponses + 1)
    assert.deepEqual(state.stored[server.url + pathname], before.stored[server.url + pathname])
  })

  await context.test('direct requests still suppress redirects and allow conditional responses', async () => {
    let pathname = '/hookrequest/direct/true',
        headers = { accept: 'text/html', 'x-fixture-hook': 'response.start' },
        first = await request(server.port, pathname, headers)

    for ( let mode of ['server', 'refresh'] ) {
      let response = await request(server.port, pathname, { ...headers, 'x-fixture-redirect': mode, 'if-none-match': first.headers.etag })

      assert.equal(response.status, 304)
      assert.equal(response.headers.location, undefined)
      assert.equal(response.headers.refresh, undefined)
      assert.equal(response.body, '')
    }
  })
})


test('HTTP action-cache hits replay context while reusing rendered output', { timeout: 30000 }, async context => {
  let server = await fixture(context, 'capture', false, { sessions: true })

  await context.test('headers, cookies, session values, next, and custom context survive repeated hits', async () => {
    let first = await request(server.port, '/replay', { accept: 'text/html', 'x-fixture-request-id': 'first' }),
        before = await server.snapshot()

    assert.equal(first.status, 200, first.body)
    assert.equal(first.body, 'tail:from-action:stored:first:null:null')
    assert.equal(before.stored['/replay']['text/html'].output, 'action:1:include:1:1:1')
    assert.equal(before.stored['/replay']['text/html'].context.include, undefined)
    assert.ok(first.headers['set-cookie'].some(value => value.startsWith('ctzn_session_id=')), JSON.stringify(first))
    let sessionCookie = first.headers['set-cookie'].find(value => value.startsWith('ctzn_session_id=')).split(';')[0]

    for ( let id of ['second', 'third'] ) {
      let reset = await request(server.port, '/sessionreset', { cookie: sessionCookie })

      assert.equal(reset.status, 200)
      let hit = await request(server.port, '/replay', { accept: 'text/html', cookie: sessionCookie, 'x-fixture-request-id': id }),
          state = await server.snapshot()

      assert.equal(hit.status, 200)
      assert.equal(hit.body, 'tail:from-action:stored:' + id + ':null:null')
      assert.equal(hit.headers['x-action'], 'tail')
      assert.equal(hit.headers['x-tail'], 'live')
      assert.equal(hit.headers['cache-control'], 'public, max-age=30')
      assert.equal(hit.headers.etag, 'tail-validator')
      assert.ok(hit.headers['set-cookie'].some(value => value.startsWith('actionCookie=stored;')))
      assert.deepEqual(state.chain, [
        { name: 'replay', controller: 'replay', action: 'handler', pathname: '/replay' },
        { name: 'replaytail', controller: 'replaytail', action: 'handler', pathname: '/replaytail' }
      ])
      assert.deepEqual(state.stored['/replay'], before.stored['/replay'])
      assert.equal(typeof state.accessed['/replay']['text/html'], 'number')
    }
    let after = await server.snapshot()

    assert.deepEqual(after.counts, { ...before.counts, tail: 3 })
    assert.equal(after.stored['/replay']['text/html'].context.header['X-Action'], 'action')
    assert.deepEqual(after.stored['/replay']['text/html'].context.custom.touched, [])
  })

  await context.test('multiple cached chain links preserve JSON and JSONP output and current metadata', async () => {
    for ( let [pathname, accept] of [['/jsonreplay', 'application/json'], ['/jsonreplay/callback/show', 'application/javascript']] ) {
      let before = await server.snapshot(),
          first = await request(server.port, pathname, { accept }),
          cold = await server.snapshot()

      assert.equal(first.status, 200)
      assert.equal(cold.stored[pathname][accept].context.include, undefined)
      assert.deepEqual(cold.stored[pathname][accept].context.local.include, {
        piece: { fromInclude: 'yes', calls: before.counts.cachedInclude + 1 },
        fresh: { calls: before.counts.include + 1 }
      })
      for ( let count = 0; count < 2; count++ ) {
        let hit = await request(server.port, pathname, { accept }),
            state = await server.snapshot()

        assert.equal(hit.status, 200)
        assert.equal(hit.body, first.body)
        assert.equal(hit.headers['x-middle'], 'cached')
        assert.deepEqual(state.stored[pathname], cold.stored[pathname])
        assert.deepEqual(state.stored['/jsonmiddle'], cold.stored['/jsonmiddle'])
        assert.deepEqual(state.chain, [
          { name: 'jsonreplay', controller: 'jsonreplay', action: 'handler', pathname },
          { name: 'jsonmiddle', controller: 'jsonmiddle', action: 'handler', pathname: '/jsonmiddle' },
          { name: 'jsonend', controller: 'jsonend', action: 'handler', pathname: '/jsonend' }
        ])
        assert.equal(state.counts.middle, before.counts.middle + 1)
        assert.equal(state.counts.cachedInclude, before.counts.cachedInclude + 1)
        assert.equal(state.counts.include, before.counts.include + 1)
      }
      let json = accept === 'application/json' ? first.body : first.body.slice('show('.length, -2)

      assert.deepEqual(JSON.parse(json), {
        jsonreplay: {
          stable: true,
          include: {
            piece: { fromInclude: 'yes', calls: before.counts.cachedInclude + 1 },
            fresh: { calls: before.counts.include + 1 }
          }
        },
        jsonmiddle: { calls: before.counts.middle + 1 },
        jsonend: { message: 'json-context' }
      })
    }
  })

  await context.test('cached refresh redirects apply without invoking the controller or view again', async () => {
    let first = await request(server.port, '/refreshreplay', { accept: 'text/html' }),
        before = await server.snapshot()

    for ( let count = 0; count < 2; count++ ) {
      let hit = await request(server.port, '/refreshreplay', { accept: 'text/html' }),
          state = await server.snapshot()

      assert.equal(hit.status, 302)
      assert.equal(hit.headers.refresh, '0;url=/destination')
      assert.equal(hit.body, first.body)
      assert.deepEqual(state.stored['/refreshreplay'], before.stored['/refreshreplay'])
      assert.equal(state.counts.refresh, 1)
      assert.equal(state.counts.refreshView, 1)
    }
  })
})


test('HTTP invalid cache parameters preserve exit-mode behavior', { timeout: 30000 }, async context => {
  let cases = [
    { pathname: '/actioncache/item/unlisted/1', yieldErrorHook: false },
    { pathname: '/actioncache/item/unlisted/1', yieldErrorHook: true },
    { pathname: '/request/item/unlisted/1', yieldErrorHook: false, status: 200 }
  ]

  for ( let { pathname, yieldErrorHook, status } of cases ) {
    await context.test(pathname + (yieldErrorHook ? ' with a yielding error hook' : ' with an immediate error hook'), async context => {
      let server = await fixture(context, 'exit', yieldErrorHook),
          exited = once(server.child, 'exit'),
          response = await request(server.port, pathname)

      // Action-cache status depends on whether rendering finishes before the hook.
      // Request-cache validation runs after send, so its 200 is independent of the hook.
      if ( status !== undefined ) {
        assert.equal(response.status, status)
      }
      assert.equal((await exited)[0], 1)
    })
  }
})
