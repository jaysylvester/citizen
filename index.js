// Initializes the framework and starts the web server

module.exports = function (customConfig) {
	var helper = require('./helper')(),
		defaultConfig = {
			mode: 'production',
			appPath: '/',
			webRoot: '/',
			appUrlFolder: '/',
			httpPort: 80
		},
		config = helper.extend(defaultConfig, customConfig),
		server = require('./server')(config);

	server.start();

	return {
		config: config,
		helper: require('./helper')(config),
		server: server
	};
};