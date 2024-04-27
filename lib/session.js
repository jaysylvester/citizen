// session management

// citizen
import helpers from './helpers.js'
// event hooks
import sessionHooks from './hooks/session.js'


const create = (request) => {
  var sessionID = '',
      started = Date.now(),
      expires = started + ( CTZN.config.citizen.sessions.lifespan * 60000 )

  while ( !CTZN.sessions[sessionID] ) {
    sessionID = generateSessionID()
    if ( !CTZN.sessions[sessionID] ) {
      CTZN.sessions[sessionID] = {
        id: sessionID,
        started: started,
        expires: expires,
        cors: request.cors || false,
        timer: setTimeout( function () {
          checkExpiration(sessionID)
        }, CTZN.config.citizen.sessions.lifespan * 60000)
      }

      helpers.log({
        label: 'Session started',
        content: CTZN.sessions[sessionID]
      })
    }
  }

  return sessionID
}


const checkExpiration = (sessionID) => {
  var now = Date.now()

  if ( CTZN.sessions[sessionID] ) {
    if ( CTZN.sessions[sessionID].expires < now ) {
      onEnd(sessionID)
    } else {
      CTZN.sessions[sessionID].timer = setTimeout( function () {
        checkExpiration(sessionID)
      }, CTZN.sessions[sessionID].expires - now)
    }
  }
}


const end = (session) => {
  if ( typeof session === 'string' ) {
    if ( CTZN.sessions[session] ) {
      clearTimeout(CTZN.sessions[session].timer)
      onEnd(session)
    }
  } else {
    Object.keys(CTZN.sessions).forEach( item => {
      if ( CTZN.sessions[item][session.key] && CTZN.sessions[item][session.key] === session.value ) {
        clearTimeout(CTZN.sessions[item].timer)
        onEnd(item)
        return false
      }
    })
  }
}


const onEnd = async (sessionID) => {
  delete CTZN.sessions[sessionID].timer
  let expiredSession = helpers.copy(CTZN.sessions[sessionID])
  delete CTZN.sessions[sessionID]

  try {
    helpers.log({
      label: 'Session ended',
      content: await sessionHooks.session.end(expiredSession)
    })
  } catch ( err ) {
    err.message = 'An error occurred during a session end event'
    err.session = expiredSession
    throw err
  }
}


const extend = (sessionID) => {
  if ( CTZN.sessions[sessionID] ) {
    CTZN.sessions[sessionID].expires = Date.now() + ( CTZN.config.citizen.sessions.lifespan * 60000 )
  }
}


const generateSessionID = () => {
  return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '')
}


export default { create, end, extend }
export { end }
