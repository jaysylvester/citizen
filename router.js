// router

module.exports = function (config) {
	var url = require('url'),
		helper = require('./helper')(config),
		methods = {

			public: {

				getRoute: function (urlToParse) {
					var pathToParse = url.parse(urlToParse).pathname,
						nameRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
						staticRegex = /^\/.*\.(avi|css|doc|docx|eot|gif|htm|html|ico|jpeg|jpg|js|mkv|mov|mp3|mp4|pdf|png|svg|ttf|txt|wmv|woff|zip).*/,
						route = {
							name: 'index',
							action: 'default',
							type: 'default',
							do: 'default',
							show: 'default',
							format: 'html',
							isStatic: false
						};
					if ( staticRegex.test(pathToParse) ) {
						route = {
							name: url.parse(urlToParse).pathname,
							isStatic: true
						};
					} else {
						if ( nameRegex.test(pathToParse) ) {
							route.name = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1');
						};
					};
					return route;
				},

				getUrlParams: function (urlToParse) {
					var pathToParse = url.parse(urlToParse).pathname,
						regex = /\/[A-Za-z]+[0-9]*\/[A-Za-z0-9-_]+\/?$/,
						parameterNames = [],
						parameterValues = [],
						assignment = '',
						urlParams = {};
					if ( regex.test(pathToParse) ) {
						for ( var i = 1; i > 0; i = pathToParse.search(/\/[A-Za-z]+[0-9]*\/[A-Za-z0-9-_]+\/?$/) ) {
							parameterNames.unshift(pathToParse.replace(/.*\/([A-Za-z]+[0-9]*)\/[A-Za-z0-9-_]+\/?$/, '$1'));
							parameterValues.unshift(pathToParse.replace(/.*\/[A-Za-z]+[0-9]*\/([A-Za-z0-9-_]+)\/?$/, '$1'));
							pathToParse = pathToParse.replace(/(.+\/)[A-Za-z]+[0-9]*\/[A-Za-z0-9-_]+\/?$/, '$1');
						}
						for ( var i = 0; i <= parameterNames.length-1; i+=1 ) {
							urlParams[parameterNames[i]] = parameterValues[i];
						}
					};
					return urlParams;
				}
			},

			private: {

			}
		};

	return methods.public;
};