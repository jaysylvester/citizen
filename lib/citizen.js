// Initializes the framework

console.log('\nInitializing citizen...\n')

import { config } from './init/config.js'
import { getHooks } from './init/hooks.js'
import { getPatterns } from './init/patterns.js'

const hooks = await getHooks(config)
const patterns = await getPatterns(config)

global.CTZN = {
  cache     : {},
  config    : config,
  hooks     : hooks,
  patterns  : patterns,
  sessions  : {},
  // citizen throws an error if apps use any of the following variable names
  // because they're reserved for the framework.
  reserved: {
    content: [
      'config',
      'cookie',
      'form',
      'payload',
      'request',
      'response',
      'route',
      'session',
      'url'
      // The include scope isn't susceptible to content overwrites, so leave it off
      // the list for now. Includes break if this is enabled, so that will have to be
      // fixed if this changes.
      // 'include'
    ],
    cookie: [
      'ctzn_referer',
      'ctzn_sessionID'
    ],
    session: [
      'cors',
      'ctzn_referer',
      'expires',
      'id',
      'started',
      'timer'
    ],
    url: [
      'action',
      'callback',
      'format',
      'output',
      'show',
      'task',
      'type',
      'ctzn_debug',
      'ctzn_debugColors',
      'ctzn_debugDepth',
      'ctzn_debugShowHidden',
      'ctzn_dump'
    ]
  }
}

CTZN.config.citizen.compression.mimeTypes  = CTZN.config.citizen.compression.mimeTypes.split(' ')
CTZN.config.citizen.sessionTimeout         = CTZN.config.citizen.sessionTimeout * 60000


// Export citizen data and methods meant for public consumption
import { clear, exists, get, set } from './cache.js'
import { log } from './helpers.js'
import { start } from './server.js'
import { end } from './session.js'

const controllers = patterns.controllers
const models = patterns.models
const views = patterns.views
const cache = { clear, exists, get, set }
const helpers = { log }
const server = { start }
const session = { end }

export default { config, controllers, models, views, cache, helpers, server, session }
