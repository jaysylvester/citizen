import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeEvent, sseOptions, lastEventId } from '../lib/sse.js'

test('SSE encodes Unicode, multiline data, controls, and empty data without magic EOF', () => {
  assert.equal(encodeEvent({ comment: 'one\r\ntwo', event: 'progress', id: '雪', retry: 0, data: 'a\rb\nc\r\nd' }).toString(), ': one\n: two\nevent: progress\nid: 雪\nretry: 0\ndata: a\ndata: b\ndata: c\ndata: d\n\n')
  assert.equal(encodeEvent({ data: '' }).toString(), 'data: \n\n')
  assert.equal(encodeEvent({ id: '' }).toString(), 'id: \n\n')
  assert.equal(encodeEvent({ data: { value: '😀' } }).toString(), 'data: {"value":"😀"}\n\n')
  assert.equal(encodeEvent({ data: 12 }, value => 'value=' + value).toString(), 'data: value=12\n\n')
})
test('SSE rejects malformed records and options before writing', () => {
  for ( let record of [{}, { extra: 1 }, { event: 'bad\nevent' }, { id: 'bad\0id' }, { data: undefined }, { retry: -1 }, { retry: null }, { retry: false }, [], 'data', { comment: 2 }, { data: 1n }] ) {
    assert.throws(() => encodeEvent(record))
  }
  assert.throws(() => encodeEvent({ data: 1 }, () => 1))
  let circular = {}; circular.circular = circular
  assert.throws(() => encodeEvent({ data: circular }))
  for ( let options of [{ heartbeat: 0 }, { heartbeat: true }, { heartbeat: undefined }, { heartbeat: 2147483648 }, { retry: undefined }, { retry: null }, { retry: true }, { retry: 1.5 }, { serialize: 4 }] ) {
    assert.throws(() => sseOptions(options))
  }
  assert.equal(sseOptions({}).heartbeat, 15000)
  assert.equal(sseOptions({}).retry, undefined)
  assert.equal(sseOptions({ heartbeat: false }).heartbeat, false)
})
test('SSE descriptor overrides preserve disabled heartbeats, zero retry, and an omitted retry directive', () => {
  let defaults = { heartbeat: 1000, retry: 3000 }
  assert.deepEqual(sseOptions({}, defaults), { heartbeat: 1000, retry: 3000, serialize: undefined })
  assert.deepEqual(sseOptions({ heartbeat: false, retry: 0 }, defaults), { heartbeat: false, retry: 0, serialize: undefined })
  assert.deepEqual(sseOptions({ retry: false }, defaults), { heartbeat: 1000, retry: undefined, serialize: undefined })
  assert.deepEqual(sseOptions({}, { heartbeat: 1000, retry: false }), { heartbeat: 1000, retry: undefined, serialize: undefined })
})
test('Last-Event-ID preserves Unicode/BOM/empty values and rejects malformed UTF-8', () => {
  assert.equal(lastEventId(undefined), null)
  assert.equal(lastEventId(''), '')
  assert.equal(lastEventId(Buffer.from('\uFEFF雪42').toString('latin1')), '\uFEFF雪42')
  assert.throws(() => lastEventId('\xff'), error => error.statusCode === 400)
})
