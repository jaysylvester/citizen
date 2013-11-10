// framework

module.exports = function (customConfig) {
	var helper = require('./helper')(),
		defaultConfig = {
			mode: 'production',
			appPath: '/',
			webRoot: '/'
		},
		config = helper.extend(defaultConfig, customConfig);

	return {
		config: config,
		helper: require('./helper')(config),
		router: require('./router')(config),
		server: require('./server')(config)
	};
};