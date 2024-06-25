// Initializes the framework

// citizen
import config   from './init/config.js'
import patterns from './init/patterns.js'


const controllers = {
        routes  : await patterns.getRoutes(config.citizen.directories.controllers + '/routes'),
        hooks   : await patterns.getHooks(config.citizen.directories.controllers + '/hooks'),
        private : await patterns.getPrivate(config.citizen.directories.controllers + '/private')
      },
      models = await patterns.getModels(config.citizen.directories.models),
      views  = await patterns.getViews(config.citizen.directories.views)


global.CTZN = {
  cache       : {},
  config      : config,
  controllers : controllers,
  models      : models,
  views       : views,
  sessions    : {},
  // citizen throws an error if apps use any of the following variable names because they're reserved for the framework
  reserved    : {
    cookie: [
      'ctzn_referer',
      'ctzn_session_id'
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
      'ctzn_debug',
      'ctzn_debugColors',
      'ctzn_debugDepth',
      'ctzn_debugShowHidden',
      'ctzn_inspect'
    ]
  }
}


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
export default { config, controllers, models, views, cache, helpers, server, session }
// import { server } from 'citizen'
export { config, controllers, models, views, cache, helpers, server, session }
