// request event hooks

// citizen
import * as helpers from '../helpers.js'


export const start = async (params) => {
  // Log the request parameters for debugging
  let remoteHost = ( params ? params.request.headers['x-forwarded-for'] || params.request.connection.remoteAddress || params.request.socket.remoteAddress || ( params.request.connection.socket ? params.request.connection.socket.remoteAddress : 'undefined' ) : 'undefined' ).replace('::ffff:', '')
  helpers.log({
    type      : 'request',
    label     : 'Remote host ' + remoteHost + ' requested ' + params.route.url,
    divider   : { top: CTZN.config.citizen.mode === 'development' ? true : false }
  })
  let logContent = {}
  CTZN.config.citizen.development.debug.scope.request ? logContent.request = params.request : false
  CTZN.config.citizen.development.debug.scope.response ? logContent.response = params.response : false
  CTZN.config.citizen.development.debug.scope.route ? logContent.route = params.route : false
  CTZN.config.citizen.development.debug.scope.url ? logContent.url = params.url : false
  CTZN.config.citizen.development.debug.scope.cookie ? logContent.cookie = params.cookie : false
  CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
  helpers.log({
    label     : 'Request parameters',
    content   : logContent,
    timestamp : false
  })
}


export const end = async () => {
  
}
