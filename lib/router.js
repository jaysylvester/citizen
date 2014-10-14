// router

'use strict';
/* jshint node: true */
/* global CTZN: false */

var helpers = require('./helpers'),
    url = require('url');

module.exports = {
  getRoute: getRoute,
  getUrlParams: getUrlParams
};

function getRoute(urlToParse) {
  var pathToParse = url.parse(urlToParse).pathname,
      nameRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
      staticRegex = /^\/.*\.([A-Za-z0-9]+)$/,
      route = {
        pathName: pathToParse,
        controller: 'index',
        renderer: 'index',
        view: 'index',
        renderedView: 'index',
        task: 'default',
        action: 'default',
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
    if ( nameRegex.test(pathToParse) ) {
      route.controller = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1');
      route.renderer = route.controller;
      route.view = route.controller;
      route.renderedView = route.controller;
    }
  }

  return route;
}

function getUrlParams(urlToParse) {
  var pathToParse = url.parse(urlToParse).pathname,
      paramsRegex = /\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?$/,
      descriptorRegex = /^\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?.*/,
      parameterNames = [],
      parameterValues = [],
      urlParams = {};

  if ( CTZN.config.citizen.urlPaths.app !== '' ) {
    pathToParse = pathToParse.replace(CTZN.config.citizen.urlPaths.app, '');
  }
  if ( paramsRegex.test(pathToParse) ) {
    while ( pathToParse.search(paramsRegex) > 0 ) {
      parameterNames.unshift(pathToParse.replace(/.*\/([A-Za-z-_]+[A-Za-z0-9-_]*)\/[^\/]+\/?$/, '$1'));
      parameterValues.unshift(pathToParse.replace(/.*\/[A-Za-z-_]+[A-Za-z0-9-_]*\/([^\/]+)\/?$/, '$1'));
      pathToParse = pathToParse.replace(/(.+)\/[A-Za-z-_]+[A-Za-z0-9-_]*\/[^\/]+\/?$/, '$1');
    }
    parameterNames.forEach( function (name, index, array) {
      // If the URL parameter is numeric, make sure it's cast as a number
      if ( helpers.isNumeric(parameterValues[index]) ) {
        urlParams[name] = +parameterValues[index];
      } else {
        urlParams[name] = parameterValues[index];
      }
    });
  }

  if ( descriptorRegex.test(pathToParse) ) {
    urlParams.descriptor = pathToParse.replace(/^\/[A-Za-z0-9-_]+\/([A-Za-z0-9-_]+)\/?.*/, '$1');
  }

  return urlParams;
}
