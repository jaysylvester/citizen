// Initializes the framework

// citizen
import config   from './init/config.js'
import hooks    from './init/hooks.js'
import patterns from './init/patterns.js'

const appHooks    = await hooks.getHooks(config.citizen.directories.hooks)
const controllers = await patterns.getControllers(config.citizen.directories.controllers)
const models      = await patterns.getModels(config.citizen.directories.models)
const views       = await patterns.getViews(config.citizen.directories.views)

global.CTZN = {
  cache     : {},
  config    : config,
  hooks     : appHooks,
  patterns  : {
    controllers: controllers,
    models:      models,
    views:       views
  },
  sessions  : {},
  // citizen throws an error if apps use any of the following variable names
  // because they're reserved for the framework.
  reserved: {
    public: [
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
      'direct',
      'output',
      'ctzn_debug',
      'ctzn_debugColors',
      'ctzn_debugDepth',
      'ctzn_debugShowHidden',
      'ctzn_dump'
    ]
  }
}

CTZN.config.citizen.sessionTimeout = CTZN.config.citizen.sessionTimeout * 60000


// Export citizen data and methods meant for public consumption
import { clear, exists, get, set } from './lib/cache.js'
import { log }                     from './lib/helpers.js'
import { start }                   from './lib/server.js'
import { end }                     from './lib/session.js'

const cache   = { clear, exists, get, set }
const helpers = { log }
const server  = { start }
const session = { end }

// Allow either:
// import citizen from 'citizen'
// import { server } from 'citizen'
export default { config, controllers, models, views, cache, helpers, server, session }
export { config, controllers, models, views, cache, helpers, server, session }
