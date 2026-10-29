// Shared live producers for proxy and browser acceptance tests.
export const files = {
  'app/controllers/hooks/request.js': 'export const start = (params, request) => { process.send({ type: \'start\', url: request.url }) }',
  'app/controllers/routes/events.js': `
    import { setTimeout as delay } from 'node:timers/promises'
    export const config = { controller: { streaming: { enabled: true }, contentTypes: ['application/json', 'text/event-stream'], forms: { maxPayloadSize: 256 } } }
    export const handler = async (params, request, response) => {
      process.send({ type: 'setup', url: request.url, id: request.lastEventId, protocol: params.route.protocol, payload: params.payload })
      if ( params.query.setup ) await delay(Number(params.query.setup), undefined, { signal: request.signal })
      if ( params.query.error ) throw Object.assign(new Error('proxy diagnostic'), { statusCode: Number(params.query.error) })
      if ( params.query.stop || params.query.reconnect && request.lastEventId !== null ) {
        response.statusCode = 204
        return { view: false }
      }
      if ( response.contentType === 'application/json' ) return { local: { snapshot: true }, header: { 'Cache-Control': 'public, max-age=60', ...(params.query.vary ? { Vary: 'Accept' } : {}) } }
      return {
        stream: {
          format: 'sse', heartbeat: params.query.quiet ? false : 100, retry: 50,
          source: (async function* () {
            try {
              yield { id: '雪😀', data: 'first\\nsecond' }
              if ( params.query.failure ) throw new Error('producer failed')
              if ( params.query.hold ) await delay(Number(params.query.hold), undefined, { signal: request.signal })
              if ( params.query.done ) yield { event: 'complete', data: { done: true } }
            } finally { process.send({ type: 'cleanup', url: request.url }) }
          })()
        }
      }
    }
  `,
  'app/controllers/routes/index.js': 'export const handler = (params, request, response) => { response.setHeader(\'Content-Type\', \'text/html\'); response.end(\'<!doctype html><title>Citizen stream acceptance</title>\'); return {} }'
}
