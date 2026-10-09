import assert from 'node:assert/strict'
import test from 'node:test'
import helpers from '../lib/helpers.js'


test('parameter maps retain special own keys through deep copies and inheritance', () => {
  let parent = Object.fromEntries([['__proto__', 'parent'], ['constructor', 'C'], ['prototype', 'P'], ['_onTimeout', 'marker']]),
      params = { query: parent, route: { queryParams: parent } },
      clone = helpers.copy(params),
      child = helpers.extend(parent, Object.fromEntries([['__proto__', 'child'], ['page', '2']]))

  assert.deepEqual(clone, params)
  clone.query._onTimeout = 'changed'
  clone.route.queryParams.__proto__ = 'changed'
  child.constructor = 'changed'
  assert.equal(parent._onTimeout, 'marker')
  assert.equal(parent.__proto__, 'parent')
  assert.equal(parent.constructor, 'C')
  assert.equal(child.__proto__, 'child')
  assert.equal(Object.getPrototypeOf(child), Object.prototype)
  assert.equal(child.page, '2')
})


test('helper merges create own nested __proto__ data without extending prototypes', () => {
  let extension = Object.fromEntries([['__proto__', { literal: 'value' }]]),
      merged = helpers.extend({}, extension)

  assert.deepEqual(merged.__proto__, { literal: 'value' })
  assert.equal(Object.getPrototypeOf(merged), Object.prototype)
  assert.equal(Object.prototype.literal, undefined)
  merged.__proto__.literal = 'changed'
  assert.equal(extension.__proto__.literal, 'value')
})


test('copy still preserves active Node timers', () => {
  let timer = setTimeout(() => {}, 60000)

  try {
    assert.equal(helpers.copy({ timer }).timer, timer)
  } finally {
    clearTimeout(timer)
  }
})
