// Initializes the framework

module.exports = function (appConfig) {
    var helper = require('./helper')(),
        defaultConfig = {
            mode: 'production',
            directories:    {
                app:        '/',
                patterns:   '/patterns',
                public:     '/public'
            },
            urlPaths:    {
                app:     '/'
            },
            httpPort: 80,
            sessions: false,
            sessionLength: 1200000, // 20 minutes
            staticAssetUrl: ''
        },
        config = helper.extend(defaultConfig, appConfig),
        helper = require('./helper')(config),
        patterns = helper.cachePatterns(),
        server = require('./server')(config, patterns),
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
        patterns: patterns,
        server: server,
        session: session
    };
};
