// Initializes the framework

// citizen
import configure from './init/config.js'
import patterns  from './init/patterns.js'


const config = await configure(),
      controllers = {
        hooks   : await patterns.getHooks(config.directories.controllers + '/hooks'),
        routes  : await patterns.getRoutes(config.directories.controllers + '/routes')
      },
      helpers = await patterns.getHelpers(config.directories.helpers),
      models  = await patterns.getModels(config.directories.models),
      views   = await patterns.getViews(config.directories.views)


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
