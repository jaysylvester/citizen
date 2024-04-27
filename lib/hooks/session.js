// session event hooks

// citizen
import helpers from '../helpers.js'


const start = async (params, request, response, context) => {
  // Fire the app's session start hook
  if ( CTZN.controllers.hooks.session?.start ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.session.start(params, request, response, context))
  }

  return context
}


const end = async (expiredSession) => {
  let context = expiredSession

  // Fire the app's session end hook
  if ( CTZN.controllers.hooks.session?.end ) {
    context = helpers.extend(context, await CTZN.controllers.hooks.session.end(expiredSession))
  }

  return context
}


export default { start, end }
