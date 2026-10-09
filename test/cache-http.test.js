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
        mode: ${JSON.stringify(options.mode || 'production')},
        development: { debug: { view: ${Boolean(options.debug)} } },
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
  options.prepare?.(root)
  child = spawn(process.execPath, ['app/start.js'], { cwd: root, env: env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  await waitForServer(child)

  return {
    root: root,
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

  await context.test('request-cache lookup and insertion ignore query strings', async () => {
    let first = await request(server.port, '/queries?tracking=first')

    for ( let suffix of ['', '?', '?tracking=second', '?variant=a&variant=b&label=two%20words'] ) {
      assert.equal((await request(server.port, '/queries' + suffix)).body, first.body)
    }
    let state = await server.snapshot()
    assert.deepEqual(Object.keys(state.entries).filter(key => key.includes('/queries')), [server.url + '/queries'])
    await server.snapshot({ route: server.url + '/queries' })
    assert.equal(JSON.parse((await request(server.port, '/queries?refill=second')).body).queries.calls, 2)
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
      let pathname = '/hookrequest/headers-' + hook,
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
            cold = await request(server.port, '/hookrequest/coldRedirect-' + hook + '-' + status, redirectHeaders),
            pathname = '/hookrequest/warmRedirect-' + hook + '-' + status

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
        let pathname = '/hookrequest/refresh-' + hook + '-' + status,
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
    let pathname = '/hookrequest/start',
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


function prepareQueryFixture(root) {
  const controller = (name, source) => fs.writeFileSync(path.join(root, 'app/controllers/routes', name + '.js'), source),
        view = (name, source) => fs.writeFileSync(path.join(root, 'app/views', name + '.html'), source)

  fs.writeFileSync(path.join(root, 'app/controllers/hooks/request.js'), `
    export const start = async params => {
      return { queryHook: { ...params.query } }
    }
  `)
  for ( let [name, cache] of Object.entries({
    qcallback: '{}',
    qaction: '{ action: { lifespan: \'application\', urlParams: [\'id\', \'action\'] } }',
    qrequest: '{ request: { lifespan: \'application\', urlParams: [\'id\', \'action\'] } }',
    qboth: '{ action: { lifespan: \'application\', urlParams: [\'id\', \'action\'] }, request: { lifespan: \'application\', urlParams: [\'id\', \'action\'] } }',
    qempty: '{ action: { lifespan: \'application\', urlParams: [] }, request: { lifespan: \'application\', urlParams: [] } }'
  }) ) {
    controller(name, `
      let calls = 0
      export const handler = async (params, request, response, context) => ({
        cache: ${cache},
        local: { calls: ++calls, url: { ...params.url }, query: { ...params.query }, hook: context.queryHook,
                 action: params.route.action, descriptor: params.route.descriptor,
                 pathname: params.route.pathname, direct: params.route.direct }
      })
      export const edit = handler
    `)
    view(name, '<html><body><p>${query.code}|${query.state}|${query.name}|${local.calls}</p></body></html>')
  }
  controller('qauth', `
    let calls = 0
    export const handler = async params => ({
      local: { calls: ++calls },
      ...(params.query.code ? { redirect: '/signed-in', header: { 'X-Auth-Call': calls, 'X-Auth-Code': params.query.code } } : {})
    })
  `)
  controller('qparent', `
    export const handler = async (params, request) => ({
      local: { url: { ...params.url }, query: { ...params.query } },
      include: { piece: request.headers['x-object-include']
        ? { controller: '_qhead', action: 'meta' }
        : request.headers['x-target'] || '/_qhead' + (params.query.target || '') }
    })
  `)
  view('qparent', '<html><body>${include.piece}</body></html>')
  controller('_qhead', `
    let calls = 0
    export const handler = async params => ({
      cache: { action: { lifespan: 'application', urlParams: ['action', 'section'] } },
      local: { calls: ++calls, url: { ...params.url }, query: { ...params.query }, action: params.route.action }
    })
    export const meta = handler
  `)
  view('_qhead', '<header>${local.calls}</header>')
  controller('qchain', `
    export const handler = async (params, request) => ({
      cache: { request: { lifespan: 'application' } },
      local: { url: { ...params.url }, query: { ...params.query } },
      next: request.headers['x-target'] || '/_qtail' + (params.query.target || '')
    })
  `)
  controller('_qtail', `
    let calls = 0
    export const handler = async params => ({
      cache: { action: { lifespan: 'application', urlParams: ['action', 'page'] } },
      local: { calls: ++calls, url: { ...params.url }, query: { ...params.query },
               action: params.route.action, pathname: params.route.pathname, parsedPathname: params.route.parsed.pathname }
    })
    export const meta = handler
  `)
  for ( let name of ['qspecial', 'qpiece', 'qspecialtail'] ) {
    controller(name, `
      export const handler = async (params, request, response, context) => {
        let query = { ...params.query }
        params.query.__proto__ = '${name}'
        params.query._onTimeout = '${name}'
        return { local: { query, url: { ...params.url }, hook: context.queryHook },
          ${name === 'qspecial' ? 'include: { piece: \'/qpiece\', sibling: \'/qpiece\' }, next: \'/qspecialtail\'' : ''} }
      }
    `)
    view(name, '<p>${query.__proto__}|${query.constructor}|${query.prototype}|${query._onTimeout}|${query[\'\']}</p>')
  }
  controller('qdebug', `
    export const handler = async () => ({ marker: {
      text: ${JSON.stringify('&lt;<>&"\'')}, values: ['alpha', 'beta'],
      nested: { child: { value: 'deep-marker' } },
      invoke() { app.errorReports++; return 'EXECUTED' }
    } })
  `)
  view('qdebug', '<html><body>debug fixture</body></html>')
}


test('HTTP query data stays separate from routing and survives hooks, views, includes, and next', { timeout: 15000 }, async context => {
  let server = await fixture(context, 'capture', false, { prepare: prepareQueryFixture }),
      route = '/qcallback/id/path?code=a%2Fb&state=two+words&id=query&name=' + encodeURIComponent('<b>query marker</b>'),
      result = JSON.parse((await request(server.port, route)).body).qcallback,
      html = await request(server.port, route, { accept: 'text/html' })

  assert.deepEqual(result.url, { id: 'path' })
  assert.deepEqual(result.query, { code: 'a/b', state: 'two words', id: 'query', name: '<b>query marker</b>' })
  assert.deepEqual(result.hook, result.query)
  assert.ok(html.body.includes('a/b|two words|&lt;b&gt;query marker&lt;/b&gt;'))
  let cached = await request(server.port, route.replace('/qcallback/id/path', '/qboth'), { accept: 'text/html' })
  assert.equal(cached.status, 200)
  assert.ok(cached.body.includes('a/b|two words|&lt;b&gt;query marker&lt;/b&gt;'))
  await server.snapshot({ route: server.url + '/qboth', contentType: 'text/html' })
  let actionHit = await request(server.port, '/qboth?name=changed', { accept: 'text/html' }),
      requestHit = await request(server.port, '/qboth?name=changed-again', { accept: 'text/html' })
  assert.equal(actionHit.body, cached.body)
  assert.equal(requestHit.body, cached.body)
  result = JSON.parse((await request(server.port, '/qcallback/action/edit?qcallback=Title&action=missing&direct=true&callback=fn')).body).qcallback
  assert.equal(result.action, 'edit')
  assert.equal(result.descriptor, '')
  assert.equal(result.direct, false)
  assert.deepEqual(result.query, { qcallback: 'Title', action: 'missing', direct: 'true', callback: 'fn' })
  assert.deepEqual(Object.keys(JSON.parse((await request(server.port, '/qchain?direct=true')).body)), ['qchain', '_qtail'])
  assert.equal((await request(server.port, '/asset.txt?v=2', { accept: 'text/plain' })).body, 'static-content')

  let objectInclude = JSON.parse((await request(server.port, '/qparent?code=object&action=ignored', { 'x-object-include': '1' })).body).qparent.include.piece
  assert.equal(objectInclude.action, 'meta')
  assert.deepEqual(objectInclude.query, { code: 'object', action: 'ignored' })
  assert.deepEqual(objectInclude.url, { action: 'meta' })

  let suffix = '?__proto__=literal&constructor=C&prototype=P&_onTimeout=T&=empty',
      json = JSON.parse((await request(server.port, '/qspecial' + suffix)).body),
      expected = Object.fromEntries([['__proto__', 'literal'], ['constructor', 'C'], ['prototype', 'P'], ['_onTimeout', 'T'], ['', 'empty']])
  assert.deepEqual(json.qspecial.query, expected)
  assert.deepEqual(json.qspecial.include.piece.query, expected)
  assert.deepEqual(json.qspecial.include.sibling.query, expected)
  assert.deepEqual(json.qspecialtail.query, expected)
  assert.deepEqual(json.qspecial.url, {})
  assert.deepEqual(json.qspecial.hook, expected)
  assert.equal((await request(server.port, '/qspecial' + suffix, { accept: 'text/html' })).body, '<p>qspecialtail|C|P|qspecialtail|empty</p>')
})


test('HTTP caches ignore query strings and remain clearable by their existing path keys', { timeout: 15000 }, async context => {
  let server = await fixture(context, 'capture', false, { prepare: prepareQueryFixture })
  for ( let name of ['qaction', 'qrequest', 'qboth', 'qempty'] ) {
    let pathname = '/' + name, first = await request(server.port, pathname + '?tracking=first&action=missing'),
        before = await server.snapshot()
    assert.equal(JSON.parse(first.body)[name].action, 'handler')
    assert.equal(JSON.parse(first.body)[name].pathname, pathname)
    for ( let suffix of ['', '?', '?tracking=second', '?tag=a&tag=b', '?q=two+words', '?q=two%20words'] ) {
      assert.equal((await request(server.port, pathname + suffix)).body, first.body)
    }
    let after = await server.snapshot()
    assert.deepEqual(after.stored, before.stored)
    assert.ok(!Object.keys(after.entries).some(key => key.includes('?')))
    if ( name === 'qboth' ) {
      await server.snapshot({ route: server.url + pathname })
      assert.equal((await request(server.port, pathname + '?refill=request')).body, first.body)
    }
    await server.snapshot({ route: pathname })
    await server.snapshot({ route: server.url + pathname })
    assert.equal(JSON.parse((await request(server.port, pathname + '?cleared=all')).body)[name].calls, 2)
  }
  let before = await server.snapshot()
  for ( let code of ['first', 'second'] ) {
    let response = await request(server.port, '/qauth?code=' + code + '&state=callback')
    assert.equal(response.status, 302)
    assert.equal(response.headers.location, '/signed-in')
    assert.equal(response.headers['x-auth-code'], code)
    assert.equal(response.headers['x-auth-call'], code === 'first' ? '1' : '2')
  }
  assert.deepEqual((await server.snapshot()).stored, before.stored)
})


test('HTTP includes and string next inherit query maps while sharing path cache entries', { timeout: 15000 }, async context => {
  let server = await fixture(context, 'capture', false, { prepare: prepareQueryFixture }),
      first = JSON.parse((await request(server.port, '/qparent?source=email')).body).qparent.include.piece
  for ( let source of ['social', 'tracking'] ) {
    let response = JSON.parse((await request(server.port, '/qparent?source=' + source)).body).qparent.include.piece
    assert.deepEqual(response, first)
  }
  let target = '/_qhead/action/meta/section/path?section=child&action=ignored',
      parent = JSON.parse((await request(server.port, '/qparent/section/parent?section=original', { 'x-target': target })).body).qparent
  assert.equal(parent.include.piece.action, 'meta')
  assert.deepEqual(parent.include.piece.url, { section: 'path', action: 'meta' })
  assert.deepEqual(parent.include.piece.query, { section: 'child', action: 'ignored' })
  assert.equal(parent.query.section, 'original')
  assert.ok((await server.snapshot()).entries['/_qhead/action/meta/section/path'])
  let explicit = JSON.parse((await request(server.port, '/qparent', { 'x-target': '/_qhead?source=explicit' })).body).qparent.include.piece
  assert.deepEqual(explicit, first)
  let json = JSON.parse((await request(server.port, '/qchain/page/1?source=first', { 'x-target': '/_qtail/action/meta?page=2&action=ignored' })).body)
  assert.equal(json._qtail.action, 'meta')
  assert.deepEqual(json._qtail.url, { page: '1', action: 'meta' })
  assert.deepEqual(json._qtail.query, { source: 'first', page: '2', action: 'ignored' })
  assert.equal(json._qtail.pathname, '/_qtail/action/meta')
  assert.equal(json._qtail.parsedPathname, '/_qtail/action/meta')
  await server.snapshot({ route: server.url + '/qchain/page/1' })
  let second = JSON.parse((await request(server.port, '/qchain/page/1?source=second', { 'x-target': '/_qtail/action/meta?page=3' })).body)
  assert.deepEqual(second._qtail, json._qtail)
  let state = await server.snapshot()
  assert.equal(state.chain[1].pathname, '/_qtail/action/meta')
  assert.ok(state.entries['/_qtail/action/meta'])
  assert.ok(state.entries[server.url + '/qchain/page/1'])
})


test('HTTP query data is inspectable while query names cannot activate debug controls', { timeout: 15000 }, async context => {
  let server = await fixture(context, 'capture', false, { mode: 'development', prepare: prepareQueryFixture }),
      headers = { accept: 'text/html' },
      ordinary = await request(server.port, '/qdebug?ctzn_debug=1&ctzn_inspect=context.marker.invoke()', headers),
      selected = await request(server.port, '/qdebug/ctzn_debug/true/ctzn_inspect/params.query?code=abc&state=xyz', headers),
      conflicting = await request(server.port, '/qdebug/ctzn_debug/true/ctzn_inspect/context.marker.text?ctzn_inspect=context.marker.invoke()', headers)

  assert.equal(ordinary.status, 200)
  assert.ok(!ordinary.body.includes('citizen-debug'))
  assert.equal(selected.status, 200)
  assert.ok(selected.body.includes('abc'))
  assert.ok(selected.body.includes('xyz'))
  assert.equal(conflicting.status, 200)
  assert.ok(conflicting.body.includes('&amp;lt;&lt;&gt;&amp;&quot;&#39;'))
  assert.equal((await server.snapshot()).errorReports, 0)
})


function prepareDebugFixture(root) {
  prepareQueryFixture(root)
  fs.writeFileSync(path.join(root, 'app/controllers/hooks/request.js'), `
    export const start = async (params, request) => {
      request.debugObject = Object.defineProperty({ visible: 'visible-marker' }, 'hidden', { value: 'hidden-marker' })
      Object.defineProperty(request, 'debugFailure', { get() { throw new Error('private-getter-error') } })
      Object.defineProperty(request, 'debugVisited', { get() { app.errorReports++; return {} } })
    }
  `)
}


test('HTTP debug hardening preserves inspection and rejects expressions without errors or side effects', { timeout: 15000 }, async context => {
  for ( let errors of ['capture', 'exit'] ) {
    let server = await fixture(context, errors, false, { mode: 'development', prepare: prepareDebugFixture }),
        headers = { accept: 'text/html' },
        inspect = async (selector, { depth = 4, hidden = false, query = '' } = {}) => {
          let response = await request(server.port, '/qdebug/ctzn_debug/true/ctzn_inspect/' + selector +
            '/ctzn_debugDepth/' + depth + (hidden ? '/ctzn_debugShowHidden/true' : '') + query, headers)
          assert.equal(response.status, 200)
          return response.body.match(/<pre>([\s\S]*?)<\/pre>/)[1]
        }

    assert.ok((await inspect('params')).includes('query:'))
    assert.equal(await inspect('params.session'), '{}')
    assert.ok((await inspect('params.query', { query: '?code=abc&state=xyz' })).includes('abc'))
    assert.ok((await inspect('params.query[\'a.b\']', { query: '?a.b=literal-key' })).includes('literal-key'))
    assert.equal(await inspect('context.marker.values[1]'), '&#39;beta&#39;')
    assert.ok((await inspect('context.marker.invoke')).includes('[Function: invoke]'))
    assert.ok((await inspect('params.route.parsed.href')).includes(server.url + '/qdebug/'))
    assert.ok((await inspect('params.route.parsed.pathname')).includes('/qdebug/ctzn_debug/true'))
    let search = await inspect('params.route.parsed.searchParams', { query: '?tag=first&tag=last' })
    assert.ok(search.includes('URLSearchParams'))
    assert.ok(search.includes('first'))
    assert.ok(search.includes('last'))
    assert.ok((await inspect('request.socket.remoteAddress')).includes('127.0.0.1'))
    assert.equal(await inspect('response.statusCode'), '200')
    assert.equal(await inspect('params.missing.child'), 'undefined')
    assert.ok(!(await inspect('context.marker.nested', { depth: 0 })).includes('deep-marker'))
    assert.ok((await inspect('context.marker.nested')).includes('deep-marker'))
    assert.ok(!(await inspect('request.debugObject')).includes('hidden-marker'))
    assert.ok((await inspect('request.debugObject', { hidden: true })).includes('hidden-marker'))
    let text = await inspect('context.marker.text')
    assert.ok(text.includes('&amp;lt;&lt;&gt;&amp;&quot;&#39;'))
    assert.equal(await inspect('context.marker.text', { query: '?ctzn_inspect=context.marker.invoke()' }), text)
    for ( let selector of [
      'context.marker.invoke()', 'params.query[code]', 'params[', 'CTZN',
      'params.constructor', 'context.marker.prototype', 'request.debugVisited.constructor',
      'params[\'__proto__\']', 'params[\'constructor\']', 'params[\'prototype\']'
    ] ) {
      assert.equal(await inspect(selector), '&#39;Debug inspection unavailable: invalid property selector.&#39;')
    }
    let failure = await inspect('request.debugFailure')
    assert.equal(failure, '&#39;Debug inspection unavailable: property read failed.&#39;')
    assert.ok(!failure.includes('private-getter-error'))
    assert.equal((await request(server.port, '/qdebug', headers)).status, 200)
    assert.equal((await server.snapshot()).errorReports, 0)
    assert.equal(server.child.exitCode, null)
  }
  let production = await fixture(context, 'exit', false, { debug: true, prepare: prepareDebugFixture }),
      response = await request(production.port, '/qdebug/ctzn_debug/true/ctzn_inspect/context.marker.invoke()', { accept: 'text/html' })
  assert.equal(response.status, 200)
  assert.ok(!response.body.includes('citizen-debug'))
  assert.equal((await production.snapshot()).errorReports, 0)
})


const htmlValue = '<img src=x onerror=alert(1)> & "\'',
      htmlEscaped = '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;&#39;'


function prepareEscapingFixture(root) {
  const controller = (name, source) => fs.writeFileSync(path.join(root, 'app/controllers/routes', name + '.js'), source),
        view = (name, source) => fs.writeFileSync(path.join(root, 'app/views', name + '.html'), source)

  controller('escaped', `
    let calls = 0
    export const handler = async (params, request) => ({
      local: { value: request.headers['x-escape-value'], calls: ++calls },
      cache: { action: { lifespan: 'application' }, request: { lifespan: 'application' } }
    })
  `)
  view('escaped', '<article title="${local.value}">${local.value}|${local.calls}</article>')
  controller('escapedlayout', 'export const handler = async () => ({})')
  view('escapedlayout', '<main>${{route.chain.escaped.output}}</main>')
  controller('escapedincludes', `
    export const handler = async () => ({
      include: { fresh: '/freshpiece', cached: '/escapedpiece' }
    })
  `)
  view('escapedincludes', '${include.fresh}|${include[\'cached\']}|${typeof include.cached}')
  for ( let [name, cached] of [['freshpiece', false], ['escapedpiece', true]] ) {
    controller(name, `
      let calls = 0
      export const handler = async (params, request) => ({
        local: { value: request.headers['x-escape-value'], calls: ++calls },
        ${cached ? 'cache: { action: { lifespan: \'application\' } }' : ''}
      })
    `)
    view(name, '<p>${local.value}|${local.calls}</p>')
  }
  controller('plainshared', `
    export const handler = async (params, request) => ({ local: { value: request.headers['x-escape-value'] } })
  `)
  view('plainshared', '${local.value}|${{ `<li>${local.value}</li>` }}')
  controller('liveview', 'export const handler = async (params, request) => ({ local: { value: request.headers[\'x-escape-value\'] } })')
  view('liveview', '<p>${local.value}</p>')
  controller('escapingerror', 'export const handler = async () => { throw new Error(' + JSON.stringify(htmlValue) + ') }')
  // Exercise the unmodified normal scaffold with hostile data too.
  controller('index', 'export const handler = async () => ({ local: ' + JSON.stringify({
    metaData: { title: htmlValue, description: htmlValue, keywords: htmlValue },
    main: { header: htmlValue, text: htmlValue }
  }) + ' })')
}


test('HTTP template literal escaping survives includes, caches, and production view edits', { timeout: 15000 }, async context => {
  let server = await fixture(context, 'capture', false, { prepare: prepareEscapingFixture }),
      headers = { accept: 'text/html', 'x-escape-value': htmlValue }

  await context.test('fresh and action-cached includes remain strings with raw rendered markup', async () => {
    let first = await request(server.port, '/escapedincludes', headers),
        second = await request(server.port, '/escapedincludes', headers),
        snapshot = await server.snapshot()

    assert.equal(first.status, 200)
    assert.equal(first.body, '<p>' + htmlEscaped + '|1</p>|<p>' + htmlEscaped + '|1</p>|string')
    assert.equal(second.body, '<p>' + htmlEscaped + '|2</p>|<p>' + htmlEscaped + '|1</p>|string')
    assert.equal(typeof snapshot.stored['/escapedpiece']['text/html'].output, 'string')
  })

  await context.test('layout markup and escaping survive an action hit with a cold request cache', async context => {
    let server = await fixture(context, 'capture', false, { prepare(root) {
      prepareEscapingFixture(root)
      let configPath = path.join(root, 'citizen.config.js')

      fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('errors:', 'layout: { controller: \'escapedlayout\' }, errors:'))
    } }),
        first = await request(server.port, '/escaped', headers),
        expected = '<main><article title="' + htmlEscaped + '">' + htmlEscaped + '|1</article></main>'

    assert.equal(first.status, 200, first.body)
    assert.equal(first.body, expected)
    await server.snapshot({ route: server.url + '/escaped', contentType: 'text/html' })
    let warm = await request(server.port, '/escaped', { ...headers, 'x-escape-value': 'changed' }),
        hit = await request(server.port, '/escaped', { ...headers, 'x-escape-value': 'changed again' })

    assert.equal(warm.body, expected)
    assert.equal(hit.body, expected)
    let snapshot = await server.snapshot()

    assert.equal(snapshot.stored['/escaped']['text/html'].context.local.calls, 1)
    assert.equal(snapshot.stored[server.url + '/escaped']['text/html'].output, expected)
  })

  await context.test('shared HTML/plain-text views use different compilation modes', async () => {
    let html = await request(server.port, '/plainshared', headers),
        plain = await request(server.port, '/plainshared', { ...headers, accept: 'text/plain' })

    assert.equal(html.body, htmlEscaped + '|<li>' + htmlEscaped + '</li>')
    assert.equal(plain.headers['content-type'], 'text/plain')
    assert.equal(plain.body, htmlValue + '|<li>' + htmlValue + '</li>')
  })

  await context.test('JSON and JSONP retain application strings without HTML entities', async () => {
    let json = await request(server.port, '/plainshared', { ...headers, accept: 'application/json' }),
        jsonp = await request(server.port, '/plainshared/callback/show', { ...headers, accept: 'application/javascript' }),
        expected = { plainshared: { value: htmlValue } }

    assert.deepEqual(JSON.parse(json.body), expected)
    assert.ok(jsonp.body.startsWith('show('))
    assert.deepEqual(JSON.parse(jsonp.body.slice(5, -2)), expected)
  })

  await context.test('production reads changed views and never serves stale code after a compile failure', async () => {
    let first = await request(server.port, '/liveview', headers),
        file = path.join(server.root, 'app/views/liveview.html')

    assert.equal(first.body, '<p>' + htmlEscaped + '</p>')
    fs.writeFileSync(file, '<section>${local.value}</section>')
    assert.equal((await request(server.port, '/liveview', headers)).body, '<section>' + htmlEscaped + '</section>')
    fs.writeFileSync(file, '${{local.value}X')
    let failed = await request(server.port, '/liveview', headers)

    assert.equal(failed.status, 500)
    assert.match(failed.body, /Could not compile view/)
    assert.ok(!failed.body.includes(htmlValue))
    assert.ok(!failed.body.includes('<section>'))
    fs.writeFileSync(file, '<aside>${local.value}</aside>')
    let recovered = await request(server.port, '/liveview', headers)

    assert.equal(recovered.status, 200)
    assert.equal(recovered.body, '<aside>' + htmlEscaped + '</aside>')
  })

  await context.test('normal scaffold values are escaped without raw markers', async () => {
    let result = await request(server.port, '/', headers)

    assert.equal(result.status, 200)
    assert.ok(result.body.includes('<title>' + htmlEscaped + '</title>'))
    assert.ok(result.body.includes('content="' + htmlEscaped + '"'))
    assert.ok(result.body.includes('<h1>' + htmlEscaped + '</h1>'))
    assert.ok(!result.body.includes(htmlValue))
  })
})


test('HTTP error views and every fallback escape HTML stack text', { timeout: 15000 }, async context => {
  for ( let kind of ['scaffold', 'missing', 'failing', 'layout'] ) {
    await context.test(kind, async context => {
      let secondary = '<b>' + kind + ' failed</b> & "\'',
          secondaryEscaped = '&lt;b&gt;' + kind + ' failed&lt;/b&gt; &amp; &quot;&#39;',
          server = await fixture(context, 'capture', false, { prepare(root) {
            prepareEscapingFixture(root)
            if ( kind === 'missing' ) {
              fs.rmSync(path.join(root, 'app/views/error'), { recursive: true })
            } else if ( kind === 'failing' ) {
              fs.writeFileSync(path.join(root, 'app/views/error/500.html'), '${(() => {throw new Error(' + JSON.stringify(secondary) + ')})()}')
            } else if ( kind === 'layout' ) {
              let configPath = path.join(root, 'citizen.config.js')

              fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('errors:', 'layout: { controller: \'_layout\' }, errors:'))
              fs.writeFileSync(path.join(root, 'app/controllers/routes/_layout.js'), 'export const handler = async () => { throw new Error(' + JSON.stringify(secondary) + ') }')
            }
          } }),
          html = await request(server.port, '/escapingerror', { accept: 'text/html' }),
          plain = await request(server.port, '/escapingerror', { accept: 'text/plain' })

      assert.equal(html.status, 500)
      assert.ok(html.body.includes(htmlEscaped))
      assert.ok(!html.body.includes(htmlValue))
      assert.equal(plain.status, 500)
      assert.ok(plain.body.includes(htmlValue))
      if ( kind === 'failing' || kind === 'layout' ) {
        assert.ok(html.body.includes(secondaryEscaped))
        assert.ok(!html.body.includes(secondary))
        assert.ok(plain.body.includes(secondary))
      }
    })
  }
})


test('development debug insertion preserves replacement patterns and literal HTML text', { timeout: 10000 }, async context => {
  let server = await fixture(context, 'capture', false, { mode: 'development', debug: true, prepare: prepareEscapingFixture }),
      patterns = '$& $$ $` $\'',
      headers = { accept: 'text/html', cookie: 'debugPatterns=' + patterns + '; debugEntities=&#60<>&"\'', 'x-debug-entities': '&lt;<>&"\'' },
      response = await request(server.port, '/', headers)

  assert.equal(response.status, 200)
  assert.ok(response.body.includes('<h1>' + htmlEscaped + '</h1>'))
  assert.ok(response.body.includes('<div id="citizen-debug">\n<pre>'))
  assert.ok(response.body.includes('</pre>\n</div>\n</body>'))
  assert.ok(response.body.includes('$&amp; $$ $` $&#39;'))
  assert.ok(response.body.includes('&amp;#60&lt;&gt;&amp;&quot;&#39;'))
  assert.equal(response.body.match(/<\/body>/g).length, 1)

  let selected = await request(server.port, '/index/ctzn_debug/true/ctzn_inspect/request.headers', headers)

  assert.equal(selected.status, 200)
  assert.ok(selected.body.includes('$&amp; $$ $`'))
  assert.ok(selected.body.includes('&amp;lt;&lt;&gt;&amp;&quot;&#39;'))
  assert.equal(selected.body.match(/<\/body>/g).length, 1)
})
