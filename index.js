// Initializes the framework

// citizen
import config   from './init/config.js'
import patterns from './init/patterns.js'


const controllers = {
        hooks   : await patterns.getHooks(config.citizen.directories.controllers + '/hooks'),
        routes  : await patterns.getRoutes(config.citizen.directories.controllers + '/routes')
      },
      helpers = await patterns.getHelpers(config.citizen.directories.helpers),
      models  = await patterns.getModels(config.citizen.directories.models),
      views   = await patterns.getViews(config.citizen.directories.views)


global.CTZN = {
  cache       : {},
  config      : config,
  controllers : controllers,
  helpers     : helpers,
  models      : models,
  views       : views,
  sessions    : {}
}


// Exports meant for public consumption
import { clear, exists, get, set } from './lib/cache.js'
import { log }                     from './lib/helpers.js'
import { start }                   from './lib/server.js'
import { end }                     from './lib/session.js'

const cache   = { clear, exists, get, set }
const session = { end }

// Allow either:
// import citizen from 'citizen'
export default { config, controllers, helpers, models, views, cache, log, start, session }
// import { server } from 'citizen'
export { config, controllers, helpers, models, views, cache, log, start, session }
