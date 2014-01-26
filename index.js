// Initializes the framework and starts the web server

module.exports = function (appConfig) {
    var helper = require('./helper')(),
        defaultConfig = {
            mode: 'production',
            appPath: '/',
            webRoot: '/',
            appUrlFolder: '/',
            httpPort: 80,
            sessions: false,
            sessionLength: 1200000
        },
        config = helper.extend(defaultConfig, appConfig),
        helper = require('./helper')(config),
        server = require('./server')(config),
        session = require('./session')(config);

    CTZN = {};

    if ( config.sessions ) {
        CTZN.sessions = {};
    }

    return {
        config: config,
        helper: helper,
        events: {
            onApplicationStart: {},
            onApplicationEnd: {},
            onSessionStart: {},
            onSessionEnd: {},
            onRequestStart: {},
            onRequestEnd: {},
            onResponseStart: {},
            onResponseEnd: {},
        },
        patterns: helper.cachePatterns(),
        server: server,
        session: session
    };
};