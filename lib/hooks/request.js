// request event hooks

// citizen
import { debugScopes } from '../debug.js'
import helpers from '../helpers.js'


const start = async (params, request, response, context) => {
  helpers.log({
    label   : 'Requested: ' + params.route.url + ' | Remote host: ' + request.remoteAddress + ' | User agent: "' + request.headers['user-agent'] + '"',
    divider : { top: CTZN.config.citizen.mode === 'development' ? true : false }
  })

  // Fire the app's request start hook
  if ( CTZN.controllers.hooks.request?.start ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.request.start(params, request, response, context))
  }

  return context
}


const end = async (params, request, response, context) => {
  // Log the request parameters for debugging
  if ( CTZN.config.citizen.mode === 'development' ) {
    let logContent = debugScopes(params, CTZN.config.citizen.development.debug.scope)

    helpers.log({
      label   : 'Request parameters: ' + params.route.url + ' | Remote host: ' + request.remoteAddress + ' | User agent: "' + request.headers['user-agent'] + '"',
      content : logContent,
      // divider : { top: CTZN.config.citizen.mode === 'development' ? true : false }
    })
  }

  // Fire the app's request end hook
  if ( CTZN.controllers.hooks.request?.end ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.request.end(params, request, response, context))
  }

  return context
}


export default { start, end }
