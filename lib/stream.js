import { Readable } from 'node:stream'
import { encodeEvent, sseOptions } from './sse.js'


export function declaration(module, action, defaultStreaming = {}) {
  let configs = [defaultStreaming, ...[module?.config?.controller, module?.config?.[action]]
        .filter(config => Object.hasOwn(config || {}, 'streaming')).map(config => config.streaming)],
      enabled = false,
      sse = {}
  try {
    for ( let config of configs ) {
      if ( !config || config.constructor !== Object ) {
        throw new TypeError('streaming must be a configuration object.')
      }
      if ( Object.hasOwn(config, 'enabled') && typeof config.enabled !== 'boolean' ) {
        throw new TypeError('streaming.enabled must be a boolean.')
      }
      if ( Object.hasOwn(config, 'sse') ) {
        if ( !config.sse || config.sse.constructor !== Object ) {
          throw new TypeError('streaming.sse must be a configuration object.')
        }
        sseOptions(config.sse)
      }
      enabled = config.enabled ?? enabled
      sse = { ...sse, ...config.sse }
    }
    return { valid: true, enabled, sse }
  } catch (error) {
    return { valid: false, enabled: false, error }
  }
}


export function validateDeclaration(module, action, defaultStreaming = {}) {
  let resolved = declaration(module, action, defaultStreaming)
  if ( !resolved.valid ) {
    throw resolved.error
  }
  return resolved
}


function isSource(value) {
  return value instanceof Readable || typeof value?.[Symbol.asyncIterator] === 'function'
}


export function splitReturn(value) {
  if ( isSource(value) ) {
    return { context: {}, value, present: true }
  }
  if ( value && Object.hasOwn(value, 'stream') ) {
    let { stream, ...context } = value
    return { context, value: stream, present: true }
  }
  if ( value && (typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) ) {
    throw new TypeError('Return a controller context or an async stream source, not a synchronous iterable.')
  }
  return { context: value || {}, present: false }
}


export function prepareStream(value, onCleanupError = () => {}, defaults = {}) {
  let direct = isSource(value),
      source = direct ? value : value?.source,
      iterator,
      disposed = false,
      sourceError,
      rememberError = error => { sourceError = error },
      resource = {
        source,
        get error() { return sourceError || source?.errored },
        get iterator() {
          iterator ||= source[Symbol.asyncIterator]()
          if ( !iterator || typeof iterator.next !== 'function' ) {
            throw new TypeError('Stream source must provide an async iterator.')
          }
          return iterator
        },
        dispose() {
          if ( disposed ) {
            return
          }
          disposed = true
          try {
            if ( source instanceof Readable ) {
              source.once('close', () => source.off('error', rememberError))
              source.destroy()
              if ( source.closed ) {
                source.off('error', rememberError)
              }
            } else if ( isSource(source) ) {
              // Observe cleanup without waiting for an uncooperative pending next().
              Promise.resolve(resource.iterator.return?.()).catch(onCleanupError)
            }
          } catch (error) {
            onCleanupError(error)
          }
        }
      }

  if ( source instanceof Readable ) {
    source.on('error', rememberError)
  }
  try {
    if ( !isSource(source) ) {
      throw new TypeError('A stream source must be a Readable or async iterable.')
    }
    if ( direct ) {
      return Object.assign(resource, { format: 'raw', heartbeat: false })
    }
    if ( value?.format !== 'sse' || Object.keys(value).some(key => !['format', 'source', 'heartbeat', 'retry', 'serialize'].includes(key)) ) {
      throw new TypeError('Invalid stream descriptor; use an async source or { format: \'sse\', source, heartbeat, retry, serialize }.')
    }
    return Object.assign(resource, { format: 'sse' }, sseOptions(value, defaults))
  } catch (error) {
    resource.dispose()
    throw error
  }
}


export async function writeStream(response, stream, signal, length) {
  let failure, wakeNext, wakeDrain, timer, ready,
      pulling = false,
      bytes = 0,
      lastWrite = Date.now(),
      fail = error => {
        failure ||= error || new Error('Stream failed without an error reason.')
        wakeNext?.()
        wakeDrain?.()
      },
      closed = () => fail(Object.assign(new Error('Streaming response closed.'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })),
      aborted = () => fail(signal.reason)

  response.on('close', closed)
  response.on('error', fail)
  signal.addEventListener('abort', aborted, { once: true })
  if ( stream.source instanceof Readable ) {
    stream.source.on('error', fail)
  }

  const write = async chunk => {
    if ( failure ) {
      throw failure
    }
    if ( typeof chunk === 'string' ) {
      chunk = Buffer.from(chunk)
    } else if ( !(chunk instanceof Uint8Array) ) {
      throw new TypeError('Raw stream chunks must be strings, Buffers, or Uint8Arrays.')
    }
    if ( length !== undefined && bytes + chunk.byteLength > length ) {
      throw new Error('Stream output exceeds Content-Length.')
    }
    bytes += chunk.byteLength
    if ( !response.write(chunk) && !failure ) {
      let drained
      try {
        await new Promise(resolve => {
          drained = wakeDrain = resolve
          response.once('drain', drained)
        })
      } finally {
        response.off('drain', drained)
        wakeDrain = undefined
      }
    }
    if ( failure ) {
      throw failure
    }
    lastWrite = Date.now()
  }

  try {
    if ( signal.aborted ) {
      throw signal.reason
    }
    if ( stream.error ) {
      throw stream.error
    }
    if ( stream.retry !== undefined ) {
      await write(encodeEvent({ retry: stream.retry }))
    }
    for ( ;; ) {
      if ( failure ) {
        throw failure
      }
      if ( !pulling ) {
        pulling = true
        // Attach once per pull, not once per heartbeat. Repeated Promise.race()
        // calls would retain callbacks on an indefinitely pending source/abort.
        Promise.resolve().then(() => stream.iterator.next()).then(result => {
          ready = { result }
          wakeNext?.()
        }, fail)
      }
      if ( !ready && !failure ) {
        try {
          await new Promise(resolve => {
            wakeNext = resolve
            if ( stream.heartbeat !== false ) {
              timer = setTimeout(resolve, Math.max(0, stream.heartbeat - (Date.now() - lastWrite)))
            }
          })
        } finally {
          clearTimeout(timer)
          wakeNext = undefined
        }
      }
      if ( failure ) {
        throw failure
      }
      if ( !ready ) {
        await write(Buffer.from(': heartbeat\n\n'))
        continue
      }
      let { result } = ready
      ready = undefined
      pulling = false
      if ( !result || typeof result !== 'object' ) {
        throw new TypeError('Async iterator next() must return an iterator result.')
      }
      if ( result.done ) {
        break
      }
      await write(stream.format === 'sse' ? encodeEvent(result.value, stream.serialize) : result.value)
    }
    if ( length !== undefined && bytes !== length ) {
      throw new Error('Stream output is shorter than Content-Length.')
    }
  } finally {
    clearTimeout(timer)
    response.off('close', closed)
    response.off('error', fail)
    signal.removeEventListener('abort', aborted)
    if ( stream.source instanceof Readable ) {
      stream.source.off('error', fail)
    }
    stream.dispose()
  }
}
