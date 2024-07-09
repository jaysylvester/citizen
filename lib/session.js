// session management

// citizen
import helpers from './helpers.js'
// event hooks
import sessionHooks from './hooks/session.js'


const create = (request) => {
  let sessionID = '',
      started = Date.now(),
      expires = started + ( CTZN.config.citizen.sessions.lifespan * 60000 )

  while ( !CTZN.sessions[sessionID] ) {
    sessionID = generateSessionID()
    if ( !CTZN.sessions[sessionID] ) {
      CTZN.sessions[sessionID] = {
        properties: {
          id: sessionID,
          started: started,
          expires: expires,
          cors: request.cors || false,
          timer: setTimeout( function () {
            checkExpiration(sessionID)
          }, CTZN.config.citizen.sessions.lifespan * 60000)
        },
        app: {
          ctzn_session_id: sessionID
        }
      }

      helpers.log({
        label: 'Session started',
        content: CTZN.sessions[sessionID].properties
      })
    }
  }

  return sessionID
}


const checkExpiration = (sessionID) => {
  let now = Date.now()

  if ( CTZN.sessions[sessionID] ) {
    if ( CTZN.sessions[sessionID].properties.expires < now ) {
      onEnd(sessionID)
    } else {
      CTZN.sessions[sessionID].properties.timer = setTimeout( function () {
        checkExpiration(sessionID)
      }, CTZN.sessions[sessionID].properties.expires - now)
    }
  }
}


const end = (session) => {
  if ( typeof session === 'string' ) {
    if ( CTZN.sessions[session] ) {
      clearTimeout(CTZN.sessions[session].properties.timer)
      onEnd(session)
    }
  } else {
    Object.keys(CTZN.sessions).forEach( item => {
      if ( CTZN.sessions[item].app[session.key] && CTZN.sessions[item].app[session.key] === session.value ) {
        clearTimeout(CTZN.sessions[item].properties.timer)
        onEnd(item)
        return false
      }
    })
  }
}


const onEnd = async (sessionID) => {
  delete CTZN.sessions[sessionID].properties.timer
  let expiredSession = helpers.copy(CTZN.sessions[sessionID])
  delete CTZN.sessions[sessionID]

  try {
    helpers.log({
      label: 'Session ended',
      content: await sessionHooks.end(expiredSession)
    })
  } catch ( err ) {
    err.message = 'An error occurred during a session end event'
    err.session = expiredSession
    throw err
  }
}


const extend = (sessionID) => {
  if ( CTZN.sessions[sessionID] ) {
    CTZN.sessions[sessionID].properties.expires = Date.now() + ( CTZN.config.citizen.sessions.lifespan * 60000 )
  }
}


const generateSessionID = () => {
  return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '')
}


export default { create, end, extend }
export { end }
