import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, request } from './support/http-fixture.js'

test('ordinary endpoints negotiate before hooks, honor overrides, and reject missing renderers with JSON diagnostics', async t => {
  let app = await fixture(t, {
    'app/controllers/hooks/request.js': 'export const start = (params, request, response) => ({ initialType: response.contentType })',
    'app/controllers/routes/choice.js': `
      export const config = { json: { contentTypes: ['application/json'] }, csv: { contentTypes: ['text/csv'] }, html: { contentTypes: ['Text/HTML'] } }
      export const handler = (params, request, response, context) => {
        if ( request.headers['x-force'] ) response.contentType = request.headers['x-force']
        return { local: { initial: context.initialType, selected: response.contentType, value: '<value>' } }
      }
      export const json = handler
      export const csv = handler
      export const html = handler
    `,
    'app/views/choice.html': '${local.selected}: ${local.value}'
  })
  let axios = await request(app.port, '/choice', { headers: { accept: 'application/json, text/plain, */*' } })
  assert.equal(JSON.parse(axios.body).choice.initial, 'application/json')
  let any = await request(app.port, '/choice', { headers: { accept: '*/*' } })
  assert.equal(any.body, 'text/html: &lt;value&gt;')
  let missing = await request(app.port, '/choice/action/json')
  assert.equal(JSON.parse(missing.body).choice.initial, 'application/json')
  for ( let accept of ['', ' \t '] ) {
    let json = await request(app.port, '/choice/action/json', { headers: { accept } }),
        html = await request(app.port, '/choice', { headers: { accept } })
    assert.equal(json.status, 200)
    assert.equal(JSON.parse(json.body).choice.initial, 'application/json')
    assert.equal(html.status, 200)
    assert.equal(html.body, 'text/html: &lt;value&gt;')
  }
  let excluded = await request(app.port, '/choice', { headers: { accept: '*/*;q=0' } })
  assert.equal(excluded.status, 406)
  let mismatch = await request(app.port, '/choice', { headers: { accept: 'image/png' } })
  assert.equal(mismatch.status, 406)
  assert.equal(mismatch.headers['content-type'], 'application/json')
  let forced = await request(app.port, '/choice', { headers: { accept: 'image/png', 'x-force': 'application/json' } })
  assert.equal(forced.status, 200)
  assert.equal(JSON.parse(forced.body).choice.selected, 'application/json')
  let csv = await request(app.port, '/choice/action/csv')
  assert.equal(csv.status, 500)
  assert.equal(csv.headers['content-type'], 'application/json')
  let html = await request(app.port, '/choice/action/html')
  assert.equal(html.headers['content-type'], 'Text/HTML')
  assert.equal(html.body, 'Text/HTML: &lt;value&gt;')
})

test('negotiation matrix preserves quality, specificity, client order, and configured spelling over HTTP', async t => {
  let dual = ['application/json', 'text/event-stream'],
      app = await fixture(t, {
        'app/controllers/routes/choice.js': `
          export const config = {
            dual: { contentTypes: ['application/json', 'text/event-stream'] },
            mixed: { contentTypes: ['Application/JSON'] },
            empty: { contentTypes: [] },
            wildcard: { contentTypes: ['*/*'] },
            parameter: { contentTypes: ['text/plain; charset=utf-8'] },
            notarray: { contentTypes: 'application/json' }
          }
          export const handler = (params, request, response) => {
            let selected = response.contentType
            // Expose the negotiated value through a buffered JSON override.
            if ( selected?.toLowerCase() !== 'application/json' ) response.contentType = 'application/json'
            return { local: { selected } }
          }
          export const dual = handler
          export const mixed = handler
          export const empty = handler
          export const wildcard = handler
          export const parameter = handler
          export const notarray = handler
        `
      })
  for ( let [accept, expected] of [
    ['text/event-stream', dual[1]], ['application/json', dual[0]],
    ['text/event-stream;q=0.5, application/json;q=1', dual[0]], ['text/*', dual[1]],
    ['*/*', dual[0]], [undefined, dual[0]], ['application/json;q=0, */*;q=1', dual[1]],
    ['text/html', undefined], ['*/*;q=0', undefined], [' \t*/*;q=0 \t', undefined],
    ['', dual[0]], [' \t ', dual[0]],
    ['APPLICATION/JSON; charset=utf-8; q=1.000', dual[0]],
    ['application/json;q=.5, text/event-stream;q=0.49', dual[0]],
    ['application/json;q=0.1, application/*;q=1, text/*;q=.5', dual[1]],
    ['application/json; note="comma,semicolon;here"; q=.5', dual[0]],
    ['application/json;q=2, text/event-stream', dual[1]],
    ['application/json;q=1.001', undefined], ['application/json;q=0.1234', undefined],
    ['application/json;q=wat', undefined], ['application/json;q=1;q=0', undefined],
    ['*/json', undefined], ['text/e*', undefined],
    ['application/signed-exchange;v=b3;q=0.7,application/json;q=0.6', dual[0]]
  ] ) {
    await t.test('dual: ' + String(accept), async () => {
      let result = await request(app.port, '/choice/action/dual', { headers: accept === undefined ? {} : { accept } })
      assert.equal(result.status, 200)
      assert.equal(JSON.parse(result.body).choice.selected, expected)
    })
  }
  for ( let [accept, expected] of [
    ['application/json, text/plain, */*', 'application/json'],
    ['application/json, */*', 'application/json'],
    ['text/plain, application/json', 'text/plain'],
    ['application/json, text/plain', 'application/json'], ['*/*', 'text/html'], [undefined, 'text/html'],
    ['', 'text/html'], [' \t ', 'text/html']
  ] ) {
    await t.test('default offers: ' + String(accept), async () => {
      let result = await request(app.port, '/choice', { headers: accept === undefined ? {} : { accept } })
      assert.equal(result.status, 200)
      assert.equal(JSON.parse(result.body).choice.selected, expected)
    })
  }
  await t.test('configured strings are retained; renderer matching is case insensitive', async () => {
    let result = await request(app.port, '/choice/action/mixed', { headers: { accept: 'application/json' } })
    assert.equal(result.status, 200)
    assert.equal(result.headers['content-type'], 'Application/JSON')
    assert.equal(JSON.parse(result.body).choice.selected, 'Application/JSON')
    for ( let action of ['empty', 'wildcard', 'parameter', 'notarray'] ) {
      let invalid = await request(app.port, '/choice/action/' + action, { headers: { accept: '*/*' } })
      assert.equal(invalid.status, 500)
      assert.match(JSON.parse(invalid.body).error.error.stack, /^TypeError: contentTypes must be a nonempty array of bare type\/subtype strings/)
    }
  })
})
