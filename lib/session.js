// session management

'use strict';

module.exports = {
  public: {
    end: end,
    reset: reset
  },
  citizen: {
    create: create
  }
};



function create() {
  var sessionID = 0,
      started = Date.now(),
      expires = started + CTZN.config.citizen.sessionTimeout;

  while ( !CTZN.sessions[sessionID] ) {
    sessionID = generateSessionID();
    if ( !CTZN.sessions[sessionID] ) {
      CTZN.sessions[sessionID] = {
        id: sessionID,
        started: started,
        expires: expires,
        timer: setTimeout( function () {
          end(sessionID);
        }, CTZN.config.citizen.sessionTimeout)
      };
    }
  }

  return sessionID;
}



function end(key, value) {
  if ( arguments.length === 1 ) {
    if ( CTZN.sessions[key] ) {
      clearTimeout(CTZN.sessions[key].timer);
      delete CTZN.sessions[key];
    }
  } else {
    for ( var property in CTZN.sessions ) {
      if ( CTZN.sessions[property][key] && CTZN.sessions[property][key] === value ) {
        clearTimeout(CTZN.sessions[property].timer);
        delete CTZN.sessions[property];
        break;
      }
    }
  }
}



function reset(sessionID) {
  if ( CTZN.sessions[sessionID] ) {
    CTZN.sessions[sessionID].expires = Date.now() + CTZN.config.citizen.sessionTimeout;
    clearTimeout(CTZN.sessions[sessionID].timer);
    CTZN.sessions[sessionID].timer = setTimeout( function () {
      end(sessionID);
    }, CTZN.config.citizen.sessionTimeout);
  }
}



function generateSessionID() {
  return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '');
}
