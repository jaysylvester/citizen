citizen
=======

citizen is an event-driven MVC framework for Node.js web applications. It's still in a pre-alpha state and not suitable for public consumption, but I wanted to get it out there before the name was taken.

The goal of citizen is to handle serving, routing, and event emitter creation, while providing some useful helpers to get you on your way. The nuts and bolts of your application are up to you, but citizen's helpers are designed to work with certain patterns and conventions, which are covered throughout this guide.

The only dependency at this point is [Handlebars](https://npmjs.org/package/handlebars). Current static file serving is just a hack to enable development; I use [nginx](http://nginx.org) as a front end and I'm debating whether I should even add a module to incorporate file serving into citizen.



Installing citizen
------------------

    npm install citizen

I had some issues because of the Handlebars dependency, but installing with the `--no-bin-links` flag worked:

    npm install citizen --no-bin-links



Initializing citizen
-------------------

citizen can accept arguments when it starts, so initializing it is a bit different from typical Node.js modules because it's a function call. The following assignment will initialize citizen with the default configuration.

    app = require('citizen')();

You can pass arguments to change citizen's startup parameters:

    app = require('citizen')({
        // Mode determines certain framework behaviors such as error handling (dumps vs. friendly errors).
        // Options are 'debug', 'development', or 'production'. Default is 'production'.
        mode: 'debug',

        // Full directory path pointing to this app. Default is '/'.
        appPath: '/path/to/your/app',

        // Path to your MVC patterns
        patternPath: '/path/to/your/patterns',

        // Full directory path pointing to your web root (necessary if citizen will be serving up your static
        // files as well, but not recommended). Default is '/'.
        webRoot: '/srv/www/myapp/static',

        // If the full web address is 'http://www.mysite.com/to/myapp', then this setting would be '/to/myapp'.
        // Default is '/'.
        appUrlFolder: '/to/myapp',

        // Port for the web server. Default is 80.
        httpPort: 8080,

        // Enable session management
        sessions: true,

        // Session length in milliseconds. Default is 1200000 (20 minutes).
        sessionLength: 600000
    });

Objects returned by citizen:

`app.config`:   Includes the configuration settings you supplied at startup

`app.helper`:   A function library to make it easier to work with citizen

`app.patterns`: Controllers, models, and views (both raw and compiled) from your supplied patterns, which you can use instead of `require`

`CTZN`:         A global namespace used by citizen for session storage, among other things.

You should avoid accessing or modifying the `CTZN` namespace directly; anything that you might need in your application will be exposed by the server through local scopes.



Starting citizen
----------------

    app.server.start();



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

This content is not parsed by the framework in any way and can be whatever you like, but it must always immediately follow the pattern name and precede any name/value pairs.



MVC Patterns
------------

citizen relies on a predefined model-view-controller pattern that has a few strict requirements. As discussed above, the following URL will cause the `article` pattern to fire:

    http://www.cleverna.me/article/My-clever-article-title/id/237/page/2

The article pattern requires the following structure:

    /your-app-path/patterns/article/article-controller.js
    /your-app-path/patterns/article/article-model.js        // 
    /your-app-path/patterns/article/article.html

Each controller requires at least one public function named `handler()`. The citizen server calls `handler()` after it processes the initial request and passes it two arguments: an object containing the parameters of the request and an emitter for the controller to emit when it's done.

    // article-controller.js

    exports.handler = handler;

    function handler(args, emitter) {
        // Do some stuff, and when it's ready to go, emit the 'ready' event and pass the args object back to the server
        emitter.emit('ready', args);
    };

When it's first passed from the server, `args` contains the following objects:

`request`:    The inital request object received by the server

`response`:   The response object sent by the server

`route`:      Details of the route, such as the requested URL and the name of the route (controller)

`url`:        Any URL parameters that were passed (See "Routing and URLs" above)

`content`:    An empty object where you can place content that will be delivered to the view

`form`:       Data collected from a POST, if available

`cookie`:     An object containing any cookies that were sent with the request

`session`:    An object containing any session variables

Based on the example URL above, you'll have the following `url` object:

    {
        id: 237,
        page: 2
    }

You'll notice that `args` gets passed back to the server, which has two purposes. First, anything you want to put into your view should be appended to `args.content`. For example:

    // article-controller.js

    var model = require('./article-model.js');

    exports.handler = handler;

    function handler(args, emitter) {
        args.content = model.getContent(args.url.id, args.url.page); // Alternatively, you can use app.patterns.article.model.getContent()
                                                                     // instead of using require('./article-model.js') above.
        emitter.emit('ready', args);
    };

Here's a simple model:

    // article-model.js

    exports.getContent = getContent;

    function getContent(id, page) {
        var articles = {
            '236': {
                title: 'I Hate Node.js',
                summary: 'A list of things I hate about Node',
                pages: {
                    '1': 'First page content',
                    '2': 'Second page content'
                }
            },
            '237': {
                title: 'I <3 Node.js',
                summary: 'A list of things I love about Node',
                pages: {
                    '1': 'First page content',
                    '2': 'Second page content'
                }
            }
        };

        return {
            title: articles[id]['title'],
            summary: articles[id]['summary'],
            text: articles[id]['pages'][page]
        };
    };

In `article.html`, you can now reference the `content` object like so:

    <!DOCTYPE html>
    <html>
    <body>
        <h1>
            {{content.title}}
        </h1>
        <p id="summary">
            {{content.summary}}
        </p>
        <div id="text">
            {{content.text}}
        </div>
    </body>
    </html>

The other reason `args` gets passed back to the server is so that you can set cookies and session variables, which are discussed next.



listener()
----------

The previous example has simple methods that return static content immediately, but things are rarely that simple. The `listener()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listener()` functions for very powerful asynchronous function calls.

`listener()` takes two arguments: an object containing one or several methods you want to call, and a callback to handle the output. `listener()` requires that your functions be written to accept an optional `args` object and an `emitter` object.

Let's say our article model has two methods that need to be called before returning the results to the controller, and those methods need to be called asynchronously. One is called getContent() and the other is getViewers(). Assume that getContent() makes an asynchronous database call and won't be able to return its output immediately, so we have to listen for when it's ready and then react.

    // article-controller.js

    exports.handler = handler;

    function handler(args, emitter) {
        app.helper.listener({
            getContent: {                                     // The property name, which can be any valid JavaScript variable name
                method: app.patterns.article.model.getContent, // The method you want to call
                args:   {                                     // Optional arguments object that gets passed to the method above
                    id:   237,
                    page: 2
                }
            },
            getViewers: {
                method: app.pattern.article.model.getViewers
            }
        }, function (output) {
            args.content = output.getContent;                 // The property names you pass in become the property names within
            args.viewers = output.getViewers;                 // the output object
            emitter.emit('ready', args);                      // Emit `ready` now that we have the handler output
        });
    }


    // article-model.js

    exports.getContent = getContent;

    function getContent(args, emitter) {
        myFunction.that.gets.my.data({ id: args.id, page: args.page }, function (data) {
            emitter.emit('ready', data);                      // When the emitter emits ready, the callback in the handler is fired
        });
    };



Setting Cookies
---------------

You set cookies by appending them to `args.set.cookie`. You can set one at a time or create a complete cookie object. The following code tells the server to set `username` and `nickname` cookies that never expire:

    // article-controller.js

    function handler(args, emitter) {
        args.set.cookie = {
            username: {
                value: 'Danny',
                expires: 'never' // Valid options are 'now' (deletes an existing cookie), 'never' (current time plus 30 years),
                                 // 'session', or time in milliseconds. Default is 'session'.
            },
            nickname: {
                value: 'Doc',
                expires: 'never'
            }
        };
        emitter.emit('ready', args);
    };

The following code sets the same cookies, but they expire at the end of the browser session:

    args.set.cookie.username = 'Danny';
    args.set.cookie.nickname = 'Doc';

Other cookie options include `path` (default is `/`), `httpOnly` (default is `true`), and `secure` (default is `false`).

Cookie variables aren't available immediately after you set them. citizen has to receive the output from the controller before it can send the cookie to the user agent, so use a local instance of the variable if you need access to it during the same request.



Setting Session Variables
-------------------------

If sessions are enabled, citizen creates an object called `CTZN.sessions` and stores its session information there. You should avoid accessing this object directly and use `args.session` instead, which automatically references the current user's session.

By default, the session has two properties: `args.session.id` and `args.session.expires`. The session ID is also sent to the browser as a cookie called `CTZN_sessionID`.

Setting session variables is similar to setting cookie variables. Just use `args.set.session`:

    args.session.username = 'Danny';

Just like cookies, session variables aren't available during the same request, so use a local instance if you need to access this data right away.



Debugging
---------

If you set `mode: 'debug'` at startup, citizen dumps the current pattern's output to the console by default. You can also dump it to the view with the `dump` URL parameter:

    http://www.cleverna.me/article/id/237/page/2/dump/view

You can specify the exact object to dump with the `debug` URL parameter:

    http://www.cleverna.me/article/id/237/page/2/debug/CTZN.session             // Dumps CTZN.session to the console

    http://www.cleverna.me/article/id/237/page/2/debug/CTZN.session/dump/view   // Dumps CTZN.session to the browser

In `development` mode, you must specify the `debug` parameter to enable debugging. If you're in `production` mode, debugging is disabled.



Helpers
-------

citizen includes some basic helper functions to make your life easier.

TBD...