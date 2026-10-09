// response event hooks

// citizen
import { debugScopes } from '../debug.js'
import helpers from '../helpers.js'


const start = async (params, request, response, context) => {
  if ( CTZN.controllers.hooks.response?.start ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.response.start(params, request, response, context))
  }

  return context
}


const end = async (params, request, response, context) => {
  // Errors have already been logged by the server error handler
  if ( response.statusCode < 400 ) {
    helpers.log({
      type: 'access',
      label: helpers.serverLogLabel(response.statusCode, params, request)
    })
  }

  // Log the response parameters for debugging
  if ( CTZN.config.citizen.mode === 'development' ) {
    let logContent = debugScopes(params, CTZN.config.citizen.development.debug.scope, context)
  
    helpers.log({
      label     : 'Post-response parameters and context',
      content   : logContent,
      divider   : { bottom: true }
    })
  }

  if ( CTZN.controllers.hooks.response?.end ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.response.end(params, request, response, context))
  }

  return context
}


export default { start, end }
