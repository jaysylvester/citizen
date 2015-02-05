// router

'use strict';

var helpers = require('./helpers'),
    url = require('url');

    helpers = helpers.public.extend(helpers.public, helpers.citizen);

module.exports = {
  getRoute: getRoute,
  getUrlParams: getUrlParams
};

function getRoute(urlToParse) {
  var parsed = url.parse(urlToParse),
      pathToParse = url.parse(urlToParse).pathname,
      publicControllerRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
      descriptorRegex = /^\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?.*/,
      staticRegex = /^\/.*\.([A-Za-z0-9]+)$/,
      route = {
        url: parsed.href,
        pathname: pathToParse,
        controller: 'index',
        chain: [{ controller: 'index', action: 'handler', view: 'index'}],
        renderer: 'index',
        descriptor: '',
        view: 'index',
        renderedView: 'index',
        task: 'default',
        action: 'handler',
        type: 'default',
        show: 'default',
        format: 'html',
        isStatic: false
      };

  if ( CTZN.config.citizen.mimetypes[pathToParse.replace(staticRegex, '$1')] ) {
    route = {
      filePath: url.parse(urlToParse).pathname,
      extension: pathToParse.replace(staticRegex, '$1'),
      isStatic: true
    };
  } else {
    if ( CTZN.config.citizen.urlPaths.app !== '' ) {
      pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '');
    }
    if ( publicControllerRegex.test(pathToParse) ) {
      route.controller = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1');
      route.chain[0].controller = route.controller;
      route.chain[0].action = route.action;
      route.chain[0].view = route.controller;
      route.renderer = route.controller;
      route.view = route.controller;
      route.renderedView = route.controller;
    }
    if ( descriptorRegex.test(pathToParse) ) {
      route.descriptor = pathToParse.replace(/^\/[A-Za-z0-9-_]+\/([A-Za-z0-9-_]+)\/?.*/, '$1');
    }
  }

  return route;
}

function getUrlParams(urlToParse) {
  var pathToParse = url.parse(urlToParse).pathname,
      paramsRegex = /\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?$/,
      parameterNames = [],
      parameterValues = [],
      urlParams = {};

  if ( CTZN.config.citizen.urlPaths.app !== '' ) {
    pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '');
  }

  while ( paramsRegex.test(pathToParse) ) {
    parameterNames.unshift(pathToParse.replace(/.*\/([A-Za-z-_]+[A-Za-z0-9-_]*)\/[^\/]+\/?$/, '$1'));
    parameterValues.unshift(pathToParse.replace(/.*\/[A-Za-z-_]+[A-Za-z0-9-_]*\/([^\/]+)\/?$/, '$1'));
    pathToParse = pathToParse.replace(/(.*)\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?$/, '$1');
  }
  parameterNames.forEach( function (name, index, array) {
    // If the URL parameter is numeric, make sure it's cast as a number
    if ( helpers.isNumeric(parameterValues[index]) ) {
      urlParams[name] = +parameterValues[index];
    } else {
      urlParams[name] = parameterValues[index];
    }
  });

  return urlParams;
}
