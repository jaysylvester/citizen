// router

'use strict';
/* jshint node: true */
/* global CTZN: false */

var url = require('url');

module.exports = {
  getRoute: getRoute,
  getUrlParams: getUrlParams
};

function getRoute(urlToParse) {
  var pathToParse = url.parse(urlToParse).pathname,
      nameRegex = /^\/([A-Za-z0-9-_]+)\/?.*/,
      staticRegex = /^\/.*\.([A-Za-z0-9]+)$/,
      route = {
        name: 'index',
        safeName: 'index',
        renderer: 'index',
        view: 'index',
        renderedView: 'index',
        action: 'default',
        type: 'default',
        do: 'default',
        show: 'default',
        format: 'html',
        isStatic: false
      };

  if ( CTZN.config.citizen.mimetypes[pathToParse.replace(staticRegex, '$1')] ) {
    route = {
      name: url.parse(urlToParse).pathname,
      extension: pathToParse.replace(staticRegex, '$1'),
      isStatic: true
    };
  } else {
    if ( nameRegex.test(pathToParse) ) {
      route.name = pathToParse.replace(/^\/([A-Za-z0-9-_]+)\/?.*/, '$1');
      // route.safeName = route.name.replace('/-/g', '_');
      route.renderer = route.name;
      route.view = route.name;
      route.renderedView = route.name;
    }
  }

  return route;
}

function getUrlParams(urlToParse) {
  var pathToParse = url.parse(urlToParse).pathname,
      paramsRegex = /\/[A-Za-z_]+[A-Za-z0-9_]*\/[^\/]+\/?$/,
      descriptorRegex = /^\/[A-Za-z_]+[A-Za-z0-9_]*\/[^\/]+\/?.*/,
      parameterNames = [],
      parameterValues = [],
      urlParams = {};

  if ( paramsRegex.test(pathToParse) ) {
    while ( pathToParse.search(paramsRegex) > 0 ) {
      parameterNames.unshift(pathToParse.replace(/.*\/([A-Za-z_]+[A-Za-z0-9_]*)\/[^\/]+\/?$/, '$1'));
      parameterValues.unshift(pathToParse.replace(/.*\/[A-Za-z_]+[A-Za-z0-9_]*\/([^\/]+)\/?$/, '$1'));
      pathToParse = pathToParse.replace(/(.+)\/[A-Za-z_]+[A-Za-z0-9_]*\/[^\/]+\/?$/, '$1');
    }
    parameterNames.forEach( function (name, index, array) {
      urlParams[name] = parameterValues[index];
    });
  }

  if ( descriptorRegex.test(pathToParse) ) {
    urlParams.descriptor = pathToParse.replace(/^\/[A-Za-z0-9-_]+\/([A-Za-z0-9-_]+)\/?.*/, '$1');
  }

  return urlParams;
}
