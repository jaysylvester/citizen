import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'
import { prepareStream, writeStream, splitReturn, declaration, validateDeclaration } from '../lib/stream.js'
import { until } from './support/http-fixture.js'

function response(blocked = false) {
  let output = new EventEmitter()
  output.chunks = []
  output.write = chunk => { output.chunks.push(Buffer.from(chunk)); return !blocked }
  return output
}

test('writer waits for drain before pulling again and aborts a blocked write', async () => {
  let output = response(true), abort = new AbortController(), pulls = 0, disposed = 0,
      source = { [Symbol.asyncIterator]() { return this }, next() { pulls++; return Promise.resolve({ value: 'chunk' }) }, return() { disposed++; return Promise.resolve({ done: true }) } },
      task = writeStream(output, prepareStream(source), abort.signal)
  await until(() => output.chunks.length === 1)
  assert.equal(pulls, 1)
  assert.equal(output.listenerCount('drain'), 1)
  output.emit('drain')
  await until(() => output.chunks.length === 2)
  assert.equal(pulls, 2)
  abort.abort(new Error('cancelled'))
  await assert.rejects(task, /cancelled/)
  assert.equal(disposed, 1)
  for ( let event of ['drain', 'error', 'close'] ) {assert.equal(output.listenerCount(event), 0)}
})

test('heartbeats share one pending pull and never queue behind backpressure', async () => {
  let output = response(true), abort = new AbortController(), pulls = 0, disposed = 0,
      source = { [Symbol.asyncIterator]() { return this }, next() { pulls++; return new Promise(() => {}) }, return() { disposed++; return new Promise(() => {}) } },
      task = writeStream(output, prepareStream({ format: 'sse', source, heartbeat: 10 }), abort.signal)
  await until(() => output.chunks.length)
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(pulls, 1)
  assert.equal(output.chunks.length, 1)
  abort.abort(new Error('cancelled'))
  await assert.rejects(task, /cancelled/)
  assert.equal(disposed, 1)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(output.chunks.length, 1)
})

test('Readable errors interrupt a drain wait and cleanup is idempotent', async () => {
  let source = new Readable({ read() {} }), output = response(true), abort = new AbortController(), stream = prepareStream(source), task = writeStream(output, stream, abort.signal)
  source.push(Buffer.from('first'))
  await until(() => output.chunks.length)
  source.destroy(new Error('read failed'))
  await assert.rejects(task, /read failed/)
  stream.dispose()
  assert.equal(source.destroyed, true)
  assert.equal(output.listenerCount('drain'), 0)
})

test('raw writer counts UTF-8 bytes, rejects objects and short/long lengths', async () => {
  for ( let [chunks, length, expected] of [[['雪'], 3, null], [[], 0, null], [['snow'], 3, /exceeds/], [['snow'], 5, /shorter/], [[{}], undefined, /chunks/]] ) {
    let source = (async function* () { yield* chunks })(), task = writeStream(response(), prepareStream(source), new AbortController().signal, length)
    if ( expected ) {await assert.rejects(task, expected)}
    else {await task}
  }
})

test('declaration is local, sources are detached, invalid descriptors dispose without pulling', async () => {
  assert.equal(validateDeclaration({ config: { controller: { streaming: { enabled: true } }, handler: { streaming: { enabled: false } } } }, 'handler').enabled, false)
  assert.throws(() => validateDeclaration({ config: { controller: { streaming: 'yes' } } }, 'handler'))
  let pulled = 0, disposed = 0, source = { [Symbol.asyncIterator]() { return this }, next() { pulled++ }, return() { disposed++; return { done: true } } }
  let returned = splitReturn({ stream: source, local: { a: 1 } })
  assert.deepEqual(returned.context, { local: { a: 1 } })
  assert.equal(returned.value, source)
  assert.throws(() => prepareStream({ format: 'sse', source, heartbeat: 0 }))
  assert.equal(disposed, 1)
  assert.equal(pulled, 0)
  for ( let value of ['abc', ['a'], Buffer.from('a'), { format: 'unknown', source }] ) {assert.throws(() => prepareStream(value))}
})

test('a source resolving during a blocked heartbeat cannot bypass drain', async () => {
  let output = response(true), abort = new AbortController(), resolveNext, pulls = 0,
      source = { [Symbol.asyncIterator]() { return this }, next() { pulls++; return new Promise(resolve => { resolveNext = resolve }) }, return() { return { done: true } } },
      task = writeStream(output, prepareStream({ format: 'sse', source, heartbeat: 10 }), abort.signal)
  await until(() => output.chunks.length === 1)
  resolveNext({ value: { data: 'held until drain' } })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(output.chunks.length, 1)
  assert.equal(pulls, 1)
  output.emit('drain')
  await until(() => output.chunks.length === 2)
  assert.equal(output.chunks[1].toString(), 'data: held until drain\n\n')
  abort.abort(new Error('cancelled'))
  await assert.rejects(task, /cancelled/)
})

test('supplied streaming options are validated even when overridden', () => {
  for ( let streaming of [undefined, null, false, true, 1, 'true', [], { enabled: undefined }, { enabled: 'true' }, { sse: null }, { sse: false }, { sse: { heartbeat: undefined } }, { sse: { heartbeat: 0 } }, { sse: { retry: undefined } }, { sse: { retry: null } }, { sse: { retry: -1 } }] ) {
    assert.throws(() => validateDeclaration({ config: { handler: { streaming } } }, 'handler'))
    if ( streaming !== undefined ) {
      assert.throws(() => validateDeclaration({}, 'handler', streaming))
    }
    let module = { config: { controller: { streaming }, handler: { streaming: { enabled: true, sse: { heartbeat: 100, retry: false } } } } },
        resolved = declaration(module, 'handler', { enabled: true })
    assert.equal(resolved.valid, false)
    assert.equal(resolved.enabled, false)
    assert.throws(() => validateDeclaration(module, 'handler', { enabled: true }))
  }
  assert.equal(validateDeclaration({}, 'handler').enabled, false)
})

test('streaming declarations use action, controller, then application precedence', () => {
  for ( let application of [false, true] ) {
    assert.equal(validateDeclaration(undefined, 'handler', { enabled: application }).enabled, application)
    for ( let controller of [undefined, false, true] ) {
      for ( let action of [undefined, false, true] ) {
        let module = { config: {
          controller: controller === undefined ? {} : { streaming: { enabled: controller } },
          handler: action === undefined ? {} : { streaming: { enabled: action } }
        } }
        assert.equal(validateDeclaration(module, 'handler', { enabled: application }).enabled, action ?? controller ?? application)
      }
    }
  }
})

test('SSE defaults merge by field without changing configuration or raw output', () => {
  let defaults = { enabled: true, sse: { heartbeat: 100, retry: 900 } },
      module = { config: {
        controller: { streaming: { enabled: false, sse: { retry: 800 } } },
        handler: { streaming: { enabled: true, sse: { heartbeat: false } } }
      } },
      before = structuredClone({ defaults, module }),
      resolved = validateDeclaration(module, 'handler', defaults)
  assert.equal(resolved.enabled, true)
  assert.deepEqual(resolved.sse, { heartbeat: false, retry: 800 })
  let source = (async function* () {})(),
      inherited = prepareStream({ format: 'sse', source }, undefined, resolved.sse),
      overridden = prepareStream({ format: 'sse', source, heartbeat: 50, retry: false }, undefined, resolved.sse),
      raw = prepareStream(source, undefined, resolved.sse)
  assert.equal(inherited.heartbeat, false)
  assert.equal(inherited.retry, 800)
  assert.equal(overridden.heartbeat, 50)
  assert.equal(overridden.retry, undefined)
  assert.equal(raw.heartbeat, false)
  assert.equal(raw.retry, undefined)
  assert.deepEqual({ defaults, module }, before)
})
