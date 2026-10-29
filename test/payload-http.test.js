import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, request } from './support/http-fixture.js'

const files = {
  'app/controllers/routes/body.js': `
    export const config = { controller: { contentTypes: ['application/json'], forms: { maxPayloadSize: 16 } }, large: { forms: { maxPayloadSize: 256 } }, invalid: { forms: { maxPayloadSize: 1.5 } }, stream: { streaming: { enabled: true }, contentTypes: ['text/event-stream'] } }
    export const handler = (params, request) => { process.send({ type: 'action' }); return { local: { payload: params.payload, form: params.form, raw: request.payload } } }
    export const large = handler
    export const invalid = handler
    export const stream = () => { throw new Error('rejected body reached action') }
  `,
  'app/controllers/hooks/request.js': 'export const end = () => { process.send({ type: \'request-end\' }) }'
}

test('JSON UTF-8 survives split bytes, parameters, chunked transport, and exact byte limits', async t => {
  let app = await fixture(t, files), bytes = Buffer.from('{"x":"雪😀"}')
  assert.equal(bytes.length, 15)
  for ( let chunks of [undefined, [...bytes].map(byte => Buffer.from([byte]))] ) {
    let result = await request(app.port, '/body', { method: 'POST', headers: { 'content-type': 'Application/JSON; charset="UTF-8"', ...(chunks ? {} : { 'content-length': bytes.length }) }, body: chunks ? undefined : bytes, chunks })
    assert.equal(result.status, 200, result.body)
    assert.deepEqual(JSON.parse(result.body).body.payload, { x: '雪😀' })
    assert.equal(JSON.parse(result.body).body.raw, bytes.toString())
  }
  let exact = await request(app.port, '/body', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"x":"雪😀"} ' })
  assert.equal(exact.status, 200)
  let empty = await request(app.port, '/body', { method: 'DELETE' })
  assert.equal(empty.status, 200)
  assert.deepEqual(JSON.parse(empty.body).body.payload, {})
})

test('invalid JSON/UTF-8/charset and overflow are terminal client errors under exit', async t => {
  let app = await fixture(t, files, { errors: 'exit' })
  for ( let [body, type, status] of [
    ['{broken', 'application/json', 400],
    [Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]), 'application/json', 400],
    ['{}', 'application/json; charset=latin1', 415],
    ['12345678901234567', 'application/json', 413]
  ] ) {
    for ( let chunks of [undefined, [body]] ) {
      let result = await request(app.port, '/body', { method: 'POST', headers: { 'content-type': type, ...(chunks ? {} : { 'content-length': Buffer.byteLength(body) }) }, body: chunks ? undefined : body, chunks })
      assert.equal(result.status, status, result.body)
      assert.match(result.body, /"stack":/)
      if ( status === 413 ) {assert.equal(result.headers.connection, 'close')}
    }
  }
  assert.equal(app.messages.filter(message => ['action', 'request-end', 'error'].includes(message.type)).length, 0)
  assert.equal((await request(app.port, '/body')).status, 200)
})

test('per-action payload limits stay isolated; stream-only errors still return JSON', async t => {
  let app = await fixture(t, files), body = '{"value":"a longer body than sixteen bytes"}', options = { method: 'POST', body, headers: { 'content-type': 'application/json' } }
  assert.equal((await request(app.port, '/body/action/large', options)).status, 200)
  assert.equal((await request(app.port, '/body', options)).status, 413)
  let stream = await request(app.port, '/body/action/stream', options)
  assert.equal(stream.status, 413)
  assert.equal(stream.headers['content-type'], 'application/json')
  assert.equal(stream.headers['x-accel-buffering'], undefined)
  assert.equal((await request(app.port, '/body/action/invalid', options)).status, 500)
})

test('URL-encoded forms and multipart file bytes retain their existing representation', async t => {
  let app = await fixture(t, files)
  let form = await request(app.port, '/body', { method: 'POST', body: 'x=%E9%9B%AA', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  assert.deepEqual(JSON.parse(form.body).body.form, { x: '雪' })
  let multipart = Buffer.concat([Buffer.from('--test\r\nContent-Disposition: form-data; name="upload"; filename="bytes.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'), Buffer.from([0, 128, 255]), Buffer.from('\r\n--test--\r\n')])
  let result = await request(app.port, '/body/action/large', { method: 'POST', body: multipart, headers: { 'content-type': 'multipart/form-data; boundary=test' } })
  assert.equal(result.status, 200, result.body)
  assert.deepEqual(Buffer.from(JSON.parse(result.body).body.form.upload['bytes.bin'].binary, 'latin1'), Buffer.from([0, 128, 255]))
})

test('overflow responds before the uploader finishes and leaves the server healthy', async t => {
  let { default: http } = await import('node:http'), app = await fixture(t, files),
      call = http.request({ hostname: '127.0.0.1', port: app.port, path: '/body', method: 'POST', headers: { 'content-type': 'application/json' } }),
      result = new Promise((resolve, reject) => {
        call.once('response', response => { response.resume(); response.once('end', () => resolve(response.statusCode)) })
        call.on('error', reject)
        call.setTimeout(2000, () => call.destroy(new Error('Overflow did not respond')))
      })
  call.write('x'.repeat(17))
  assert.equal(await result, 413)
  call.destroy()
  assert.equal((await request(app.port, '/body')).status, 200)
})
