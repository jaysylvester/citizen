import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'
import { fixture, open, request, until } from './support/http-fixture.js'
import { files } from './support/stream-app.js'

const nginx = process.env.NGINX_BIN

async function freePort() {
  let listener = net.createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  let port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

async function proxy(t) {
  let app = await fixture(t, files), port = await freePort(), tls = await freePort(), root = path.join(app.root, 'nginx')
  fs.mkdirSync(root)
  let openssl = spawnSync(process.env.OPENSSL_BIN || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key.pem'), '-out', path.join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { encoding: 'utf8' })
  assert.equal(openssl.status, 0, openssl.stderr)
  const location = (name, extra = '') => `location = /${name} {
    proxy_pass http://127.0.0.1:${app.port}/events;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Forwarded "for=$remote_addr;host=$http_host;proto=$scheme;";
    ${extra}
  }`
  const locations = [
    location('events'),
    location('buffered', 'proxy_buffering on; gzip on;'),
    location('ignored', 'proxy_buffering on; gzip on; proxy_ignore_headers X-Accel-Buffering;'),
    location('gzip', 'gzip on;'),
    location('intercept', 'proxy_intercept_errors on; error_page 422 = /proxy-error;'),
    'location = /proxy-error { root ' + root + '; }',
    location('cached', 'proxy_buffering on; proxy_cache variants; proxy_cache_valid 200 1m;'),
    location('upload', 'proxy_request_buffering off;'),
    location('small', 'client_max_body_size 128;'),
    location('ignore-abort', 'proxy_ignore_client_abort on; proxy_read_timeout 3s;')
  ].join('\n')
  fs.writeFileSync(path.join(root, 'proxy-error'), '<html>proxy replacement</html>')
  fs.writeFileSync(path.join(root, 'nginx.conf'), `
    daemon off;
    pid ${root}/nginx.pid;
    error_log ${root}/error.log info;
    events {}
    http {
      access_log off;
      proxy_temp_path ${root}/proxy-temp;
      client_body_temp_path ${root}/body-temp;
      proxy_cache_path ${root}/cache keys_zone=variants:1m;
      gzip_types text/event-stream;
      gzip_min_length 1;
      server {
        listen 127.0.0.1:${port};
        listen 127.0.0.1:${tls} ssl;
        http2 on;
        ssl_certificate ${root}/cert.pem;
        ssl_certificate_key ${root}/key.pem;
        proxy_buffering off;
        proxy_cache off;
        proxy_intercept_errors off;
        proxy_ignore_client_abort off;
        gzip off;
        proxy_read_timeout 1s;
        proxy_request_buffering on;
        client_max_body_size 2m;
        ${locations}
      }
    }
  `)
  let check = spawnSync(nginx, ['-t', '-p', root + '/', '-c', 'nginx.conf'], { encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
  let child = spawn(nginx, ['-p', root + '/', '-c', 'nginx.conf'], { stdio: ['ignore', 'ignore', 'pipe'] })
  t.after(async () => {
    if ( child.exitCode === null && child.signalCode === null ) {
      let exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
  })
  await until(() => fs.existsSync(path.join(root, 'nginx.pid')))
  let ready = false
  for ( let attempt = 0; attempt < 100 && !ready; attempt++ ) {
    ready = await new Promise(resolve => {
      let socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if ( !ready ) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  assert.equal(ready, true, 'Nginx did not listen')
  return { app, port, tls }
}

test('Nginx managed-stream integration', { skip: !nginx }, async t => {
  let { app, port, tls } = await proxy(t)
  await t.test('baseline, buffering hint, and gzip deliver decoded events before EOF; ignored hints reproduce buffering', async () => {
    for ( let [endpoint, incremental] of [['events', true], ['buffered', true], ['gzip', true], ['ignored', false]] ) {
      let started = Date.now(),
          connection = await open(port, '/' + endpoint + '?hold=650', { headers: { accept: 'text/event-stream', 'accept-encoding': 'gzip' } }), decoded = '', firstAt
      let compressed = connection.response.headers['content-encoding'] === 'gzip',
          decoder = compressed ? zlib.createGunzip() : connection.response
      decoder.on('data', chunk => {
        decoded += chunk
        if ( decoded.includes('data: first') ) {
          firstAt ??= Date.now() - started
        }
      })
      decoder.on('error', () => {})
      if ( compressed ) {
        decoder.setEncoding('utf8')
        // open() has already begun collecting; replay any bytes received before this continuation.
        for ( let chunk of connection.chunks ) {
          decoder.write(chunk)
        }
        connection.response.pipe(decoder)
      } else {
        decoded = Buffer.concat(connection.chunks).toString()
        if ( decoded.includes('data: first') ) {
          firstAt = Date.now() - started
        }
      }
      if ( incremental ) {
        await until(() => decoded.includes('data: first'), endpoint + ' buffered events', 500)
        assert.equal(connection.response.complete, false)
        assert.ok(firstAt < 500)
      }
      await connection.body
      await until(() => decoded.includes('data: first'))
      if ( !incremental ) {
        assert.ok(firstAt >= 500, 'Ignoring the buffering hint must hold the first decoded event')
      }
    }
  })
  await t.test('heartbeats survive idle timeout; quiet streams and slow setup expose proxy boundaries', async () => {
    assert.equal((await request(port, '/events?hold=1400', { headers: { accept: 'text/event-stream' } })).aborted, false)
    assert.equal((await request(port, '/events?hold=1400&quiet=1', { headers: { accept: 'text/event-stream' } })).aborted, true)
    let setup = await request(port, '/events?setup=1400', { headers: { accept: 'text/event-stream' } })
    assert.equal(setup.status, 504)
    assert.match(setup.headers['content-type'], /text\/html/)
  })
  await t.test('client abort propagates upstream; intercepted errors and proxy upload limits are distinct', async () => {
    let connection = await open(port, '/events?hold=3000&abort=1', { headers: { accept: 'text/event-stream' } })
    connection.call.destroy()
    await until(() => app.messages.find(message => message.type === 'end' && message.url.includes('abort=1')))
    assert.equal(app.messages.find(message => message.type === 'end' && message.url.includes('abort=1')).outcome, 'cancelled')
    let error = await request(port, '/events?error=422', { headers: { accept: 'text/event-stream' } })
    assert.equal(error.status, 422)
    assert.match(error.body, /proxy diagnostic/)
    assert.equal(error.headers['content-type'], 'application/json')
    let intercepted = await request(port, '/intercept?error=422', { headers: { accept: 'text/event-stream' } })
    assert.equal(intercepted.body, '<html>proxy replacement</html>')
    let small = await request(port, '/small', { method: 'POST', body: 'x'.repeat(129) })
    assert.equal(small.status, 413)
    assert.match(small.headers['content-type'], /text\/html/)
    let upload = await request(port, '/upload', { method: 'POST', body: 'x'.repeat(257), headers: { accept: 'text/event-stream' } })
    assert.equal(upload.status, 413)
    assert.equal(upload.headers['content-type'], 'application/json')
  })
  await t.test('cache-off protects dual-format requests; a cached JSON response can otherwise mask SSE', async () => {
    for ( let route of ['cached', 'events'] ) {
      let snapshot = await request(port, '/' + route, { headers: { accept: 'application/json' } })
      assert.equal(snapshot.status, 200)
      let events = await request(port, '/' + route, { headers: { accept: 'text/event-stream' } })
      assert.match(events.headers['content-type'], route === 'cached' ? /application\/json/ : /text\/event-stream/)
    }
  })
  await t.test('request buffering gates request-start; ignored browser abort retains upstream setup', async () => {
    for ( let route of ['events', 'upload'] ) {
      let query = '?buffer-test=' + route,
          call = http.request({ hostname: '127.0.0.1', port, path: '/' + route + query, method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' } }),
          result = new Promise((resolve, reject) => {
            call.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)) })
            call.on('error', reject)
          })
      call.write('{"x":')
      if ( route === 'upload' ) {
        await until(() => app.messages.some(message => message.type === 'start' && message.url.endsWith(query)))
      } else {
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(app.messages.some(message => message.type === 'start' && message.url.endsWith(query)), false)
      }
      call.end('"雪"}')
      assert.equal(await result, 200)
    }
    for ( let route of ['events', 'ignore-abort'] ) {
      let query = '?setup=350&setup-abort=' + route,
          call = http.get({ hostname: '127.0.0.1', port, path: '/' + route + query, headers: { accept: 'text/event-stream' } })
      call.on('error', () => {})
      await until(() => app.messages.some(message => message.type === 'setup' && message.url.endsWith(query)))
      call.destroy()
      await until(() => app.messages.find(message => message.type === 'end' && message.url.endsWith(query)))
      assert.equal(app.messages.find(message => message.type === 'end' && message.url.endsWith(query)).outcome, route === 'events' ? 'cancelled' : 'finished')
    }
    let failed = await request(port, '/events?failure=1', { headers: { accept: 'text/event-stream' } })
    assert.equal(failed.status, 200)
    assert.equal(failed.aborted, true)
  })
  await t.test('TLS HTTP/2 frontend forwards UTF-8 reconnect ID, HTTPS, HEAD, 204, and POST SSE', async () => {
    let client = http2.connect('https://127.0.0.1:' + tls, { rejectUnauthorized: false })
    try {
      for ( let [method, route, expected] of [['GET', '/events', 200], ['HEAD', '/events', 200], ['GET', '/events?stop=1', 204], ['POST', '/events', 200]] ) {
        let call = client.request({ ':method': method, ':path': route, accept: 'text/event-stream', 'last-event-id': Buffer.from('雪😀').toString('latin1'), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }), body = ''
        call.setEncoding('utf8')
        call.on('data', chunk => { body += chunk })
        let headers = once(call, 'response'), ended = once(call, 'end')
        call.end(method === 'POST' ? '{"x":"雪"}' : undefined)
        assert.equal((await headers)[0][':status'], expected)
        await ended
        if ( method === 'HEAD' || expected === 204 ) {assert.equal(body, '')}
        else {assert.match(body, /data: first/)}
      }
      assert.equal(client.alpnProtocol, 'h2')
      assert.ok(app.messages.some(message => message.type === 'setup' && message.id === '雪😀' && message.protocol === 'https'))
      assert.ok(app.messages.some(message => message.payload?.x === '雪'))
      let aborted = client.request({ ':path': '/events?hold=2000&h2abort=1', accept: 'text/event-stream' })
      aborted.on('data', () => {})
      await once(aborted, 'response')
      aborted.close(http2.constants.NGHTTP2_CANCEL)
      await until(() => app.messages.find(message => message.type === 'end' && message.url.includes('h2abort=1')))
      assert.equal(app.messages.find(message => message.type === 'end' && message.url.includes('h2abort=1')).outcome, 'cancelled')
    } finally {
      client.destroy()
    }
  })
  assert.doesNotMatch(app.output, /ERR_HTTP_HEADERS_SENT|Unhandled promise rejection/)
})
