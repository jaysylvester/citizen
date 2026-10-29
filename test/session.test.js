import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import helpers from '../lib/helpers.js'
import session from '../lib/session.js'


test.beforeEach(context => {
  global.CTZN = {
    config: { citizen: { sessions: { lifespan: 20 } } },
    sessions: {}
  }
  context.mock.method(helpers, 'log', () => {})
})


test.afterEach(() => {
  for ( let value of Object.values(CTZN.sessions) ) {
    clearTimeout(value.properties.timer)
  }
  delete global.CTZN
})


test('sessions use 32-character hexadecimal IDs without Math.random', context => {
  context.mock.method(Math, 'random', () => assert.fail('Session IDs must use cryptographic randomness'))

  let id = session.create({})

  assert.match(id, /^[0-9a-f]{32}$/)
  assert.equal(CTZN.sessions[id].properties.id, id)
  assert.equal(CTZN.sessions[id].app.ctzn_session_id, id)
})


test('session creation retries collisions without reusing or changing the existing session', context => {
  let firstBytes = Buffer.alloc(16, 0xab),
      nextBytes = Buffer.alloc(16, 0xcd),
      values = [firstBytes, firstBytes, firstBytes, nextBytes],
      random = context.mock.method(crypto, 'randomBytes', size => {
        assert.equal(size, 16)
        assert.ok(values.length, 'Unexpected extra session ID generation')
        return values.shift()
      }),
      first = session.create({}),
      existing = CTZN.sessions[first],
      properties = { ...existing.properties }

  existing.app.user = 'first-user'

  let next = session.create({})

  assert.equal(next, nextBytes.toString('hex'))
  assert.notEqual(next, first)
  assert.equal(random.mock.callCount(), 4)
  assert.equal(Object.keys(CTZN.sessions).length, 2)
  assert.equal(CTZN.sessions[first], existing)
  assert.deepEqual(existing.properties, properties)
  assert.deepEqual(existing.app, { ctzn_session_id: first, user: 'first-user' })
  assert.notEqual(CTZN.sessions[next].app, existing.app)
  assert.deepEqual(CTZN.sessions[next].app, { ctzn_session_id: next })
})
