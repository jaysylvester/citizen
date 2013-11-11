citizen
=======

citizen is an event-driven MVC framework for Node.js web applications. It's still in a pre-alpha state and not suitable for public consumption, but I wanted to get it out there before the name was taken.

The goal of citizen is to handle serving, routing, and event emitter creation, while providing some useful helpers to get you on your way. The nuts and bolts of your application are up to you, but citizen's helpers are designed to work with certain patterns and conventions, which are covered throughout this guide.

The only dependency at this point is [Handlebars](https://npmjs.org/package/handlebars), but I'll probably add a static file server at some point as well (current static file serving is only a placeholder to ease development).


Installing citizen
------------------

	npm install citizen

I had some issues because of the Handlebars dependency, but installing with the `--no-bin-links` flag worked:

	npm install citizen --no-bin-links


Initializing citizen
-------------------

citizen can accept arguments when it starts, so initializing it is a bit different from typical Node.js modules because it's a function call. The following assignment will initialize citizen with a default configuration.

	citizen = require('citizen')();

You can pass arguments to change citizen's startup parameters:

	citizen = require('citizen')({
		// Mode determines certain framework behaviors such as error handling (dumps vs. friendly errors).
		// Options are 'debug', 'development', or 'production'. Default is 'production'.
		mode: 'debug',

		// Full directory path pointing to this app. Default is '/'.
		appPath: '/path/to/your/app',

		// Full directory path pointing to your web root (necessary if citizen will be serving up your static
		// files as well, but not recommended). Default is '/'.
		webRoot: '/srv/www/myapp/static',

		// If the full web address is 'http://www.mysite.com/to/myapp', then this setting would be '/to/myapp'.
		// Default is '/'.
		appUrlFolder: '/',

		// Port for the web server, which citizen creates and starts automatically on initialization.
		// Default is 80.
		httpPort: 8080
	});

The only objects citizen currently returns are its configuration (`citizen.config`) and helper (`citizen.helper`).


Routing and URLs
----------------

Apps using citizen have a simple URL structure that determines which controller to fire, passes URL parameters, and makes a bit of room for SEO-friendly content. The structure looks like this:

	http://www.site.com/pattern-name/SEO-content-goes-here/parameterName/value/anotherParameter/anotherValue

For example, let's say your site's base URL is:

	http://www.cleverna.me/

Requesting that URL will cause the `index` controller to fire, because the index pattern is the default pattern. The following URL will also cause the index controller to fire:

	http://www.cleverna.me/index

If you have an `article` pattern, you'd request it like this:

	http://www.cleverna.me/article

Instead of query strings, citizen uses an SEO-friendly method of passing URL parameters consisting of name/value pairs. If you had to pass an article ID of 237 to get the correct article and a page number of 2 to get the correct page, you'd append name/value pairs to the URL:

	http://www.cleverna.me/article/id/237/page/2

citizen also lets you optionally insert relevent content into your URLs, like so:

	http://www.cleverna.me/article/My-clever-article-title/id/237/page/2


MVC Patterns
------------

To be continued...