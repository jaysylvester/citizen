// response event hooks

// citizen
import helpers from '../helpers.js'


const start = async () => {

}


const end = async (params, context) => {
  // Log the response parameters for debugging
  let logContent = {}
  CTZN.config.citizen.development.debug.scope.config  ? logContent.config  = params.config  : false
  CTZN.config.citizen.development.debug.scope.cookie  ? logContent.cookie  = params.cookie  : false
  CTZN.config.citizen.development.debug.scope.form    ? logContent.form    = params.form    : false
  CTZN.config.citizen.development.debug.scope.payload ? logContent.payload = params.payload : false
  CTZN.config.citizen.development.debug.scope.route   ? logContent.route   = params.route   : false
  CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
  CTZN.config.citizen.development.debug.scope.url     ? logContent.url     = params.url     : false
  CTZN.config.citizen.development.debug.scope.context ? logContent.context = context        : false
  helpers.log({
    label     : 'Post-response parameters and context',
    content   : logContent,
    divider   : { bottom: true },
    timestamp : false
  })
}


export default { start, end }
