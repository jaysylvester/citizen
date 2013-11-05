// app and framework settings - delete and die
// Change the mode variable to use different settings for different application modes (debug, development, or production)

var mode = 'development',
	config = {
		'debug': {
			'mode': 'debug', // Application mode, options are 'debug', 'development', or 'production'
			'port': 8080, // Port for the web server
			'appPath': '/media/sf_Sites/forumjs/site/app', // Full directory path pointing to this app
			'webRoot': '/media/sf_Sites/forumjs/site/static', // Full directory path pointing to your web root
			'appFolder': '/', // URL path from the web root to this app (if the full web address is 'http://www.mysite.com/to/myapp', then this setting would be '/to/myapp')
			'staticAssetUrl': '//ginstatic.forumjs.com',
			'errors': {
				'default': 'We seem to be having some problems. Sorry about that.'
			}
		},
		'development': {
			'mode': 'development', // Application mode, options are 'debug', 'development', or 'production'
			'port': 8080, // Port for the web server
			'appPath': '/media/sf_Sites/forumjs/site/app', // Full directory path pointing to this app
			'webRoot': '/media/sf_Sites/forumjs/site/static', // Full directory path pointing to your web root
			'appFolder': '/', // URL path from the web root to this app (if the full web address is 'http://www.mysite.com/to/myapp', then this setting would be '/to/myapp')
			'staticAssetUrl': '//ginstatic.forumjs.com',
			'errors': {
				'default': 'We seem to be having some problems. Sorry about that.'
			}
		},
		'production': {
			'mode': 'production', // Application mode, options are 'debug', 'development', or 'production'
			'port': 8080, // Port for the web server
			'appPath': '/media/sf_Sites/forumjs/site/app', // Full directory path pointing to this app
			'webRoot': '/media/sf_Sites/forumjs/site/static', // Full directory path pointing to your web root
			'appFolder': '/', // URL path from the web root to this app (if the full web address is 'http://www.mysite.com/to/myapp', then this setting would be '/to/myapp')
			'staticAssetUrl': '//static.forumjs.com',
			'errors': {
				'default': 'We seem to be having some problems. Sorry about that.'
			}
		}
	};

exports.config = config[mode];