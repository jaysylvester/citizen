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
      staticRegex = /^\/.*\.([A-Za-z0-9-_]+)$/,
      route = {
        parsed: parsed,
        url: parsed.href,
        pathname: pathToParse,
        controller: 'index',
        action: 'handler',
        chain: [{ controller: 'index', action: 'handler', view: 'index'}],
        renderer: 'index',
        descriptor: '',
        view: 'index',
        renderedView: 'index',
        ajax: false,
        format: 'html',
        show: 'default',
        task: 'default',
        type: 'default',
        isStatic: false
      };

  if ( CTZN.config.citizen.mimetypes[pathToParse.replace(staticRegex, '$1')] ) {
    route = {
      url: parsed.href,
      pathname: pathToParse,
      filePath: url.parse(urlToParse).pathname,
      extension: pathToParse.replace(staticRegex, '$1'),
      isStatic: true
    };

    if ( CTZN.config.citizen.urlPaths.app !== '/' && route.filePath.indexOf(CTZN.config.citizen.urlPaths.app) === 0 ) {
      route.filePath = route.filePath.replace(CTZN.config.citizen.urlPaths.app, '');
    }
  } else {
    if ( CTZN.config.citizen.urlPaths.app !== '/' ) {
      pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '');
    }

    if ( publicControllerRegex.test(pathToParse) ) {
      route.controller = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1');
    }

    if ( !CTZN.patterns.controllers[route.controller] && CTZN.config.citizen.fallbackController.length ) {
      route.controller = CTZN.config.citizen.fallbackController;
    }

    route.chain[0].controller = route.controller;
    route.chain[0].action = route.action;
    route.chain[0].view = route.controller;
    route.renderer = route.controller;
    route.view = route.controller;
    route.renderedView = route.controller;
    route.descriptor = pathToParse.replace(/^\/[A-Za-z0-9-_]+\/([A-Za-z0-9-_]+)\/?.*/, '$1').replace(/\//g, '');

  }

  return route;
}



function getUrlParams(urlToParse) {
  var pathToParse = url.parse(urlToParse).pathname,
      paramsRegex = /\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?$/,
      parameterNames = [],
      parameterValues = [],
      urlParams = {};

  if ( CTZN.config.citizen.urlPaths.app !== '/' ) {
    pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '');
  }

  while ( paramsRegex.test(pathToParse) ) {
    parameterNames.unshift(pathToParse.replace(/.*\/([A-Za-z-_]+[A-Za-z0-9-_]*)\/[^\/]+\/?$/, '$1'));
    parameterValues.unshift(pathToParse.replace(/.*\/[A-Za-z-_]+[A-Za-z0-9-_]*\/([^\/]+)\/?$/, '$1'));
    pathToParse = pathToParse.replace(/(.*)\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?$/, '$1');
  }

  for ( var i = 0; i < parameterNames.length; i++ ) {
    urlParams[parameterNames[i]] = parameterValues[i];
  }

  return urlParams;
}
