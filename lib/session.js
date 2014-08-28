// session management

module.exports = function (config) {
    var methods = {

            public: {

                new: function () {
                    var sessionID = 0,
                        date = new Date();

                    while ( !CTZN.sessions[sessionID] ) {
                        sessionID = methods.private.generateSessionID();
                        if ( !CTZN.sessions[sessionID] ) {
                            CTZN.sessions[sessionID] = {
                                id: sessionID,
                                expires: date.getTime() + config.sessionLength
                            };
                        }
                    }

                    return sessionID;
                },

                end: function (sessionID) {

                }

            },

            private: {

                generateSessionID: function () {
                    var date = new Date();
                    return Math.random().toString().replace('0.', '') + Math.random().toString().replace('0.', '');
                }

            }

        };

    return methods.public;
};
