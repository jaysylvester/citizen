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

        // Mode determines certain framework behaviors such as error handling (dumps vs. friendly
        // errors). Options are 'debug', 'development', or 'production'. Default is 'production'.
        mode: 'debug',

        directories:    {
            // Full directory path pointing to this app. Default is '/'.
            app:         '/path/to/your/app',

            // Full directory path pointing to your patterns. Default is '/patterns'.
            patterns:    '/path/to/your/app/patterns',

            // Full directory path pointing to your static assets if you're using citizen to serve them. Default is '/public'.
            public:      '/path/to/your/static/assets'
        },

        urlPaths:       {
            // URL path to this app. If your app's URL is http://www.site.com/my/app, then this
            // should be set to '/my/app'. Default is '/'.
            app:            '/'
        },

        // Port for the web server. Default is 80.
        httpPort: 8080,

        // Enable session management
        sessions: true,

        // Session length in milliseconds. Default is 1200000 (20 minutes).
        sessionLength: 600000,

        // If you use a separate URL to serve your static assets, specify the root URL here.
        staticAssetUrl: '//static.yoursite.com'
    });

Objects returned by citizen:

- `app.config`   Includes the configuration settings you supplied at startup
- `app.helper`   A function library to make it easier to work with citizen
- `app.patterns` Controllers, models, and views (both raw and compiled) from your supplied patterns, which you can use instead of `require`
- `app.server`   Functions related to starting and running the web server
- `CTZN`         A global namespace used by citizen for session storage, among other things.

You should avoid accessing or modifying the `CTZN` namespace directly; anything that you might need in your application will be exposed by the server through local scopes.



Starting the web server
-----------------------

    app.server.start();



Routing and URLs
----------------

Apps using citizen have a simple URL structure that determines which controller to fire, passes URL parameters, and makes a bit of room for SEO-friendly content. The structure looks like this:

    http://www.site.com/pattern-name/SEO-content-goes-here/parameter/value/parameter2/value2

For example, let's say your site's base URL is:

    http://www.cleverna.me/

Requesting that URL will cause the `index` controller to fire, because the index pattern is the default pattern. The following URL will also cause the index controller to fire:

    http://www.cleverna.me/index

If you have an `article` pattern, you'd request it like this:

    http://www.cleverna.me/article

Instead of query strings, citizen uses an SEO-friendly method of passing URL parameters consisting of name/value pairs. If you had to pass an article ID of 237 and a page number of 2, you'd append name/value pairs to the URL:

    http://www.cleverna.me/article/id/237/page/2

Valid parameter names must start with a letter or underscore and may contain numbers.

citizen also lets you optionally insert relevent content into your URLs, like so:

    http://www.cleverna.me/article/My-clever-article-title/id/237/page/2

This SEO content is not parsed by the framework in any way and can be whatever you like, but it must always immediately follow the pattern name and precede any name/value pairs.



MVC Patterns
------------

citizen relies on a predefined model-view-controller pattern that has a few strict requirements. The article pattern mentioned above would require the following structure:

    /your-app-path/patterns/article/article-controller.js
    /your-app-path/patterns/article/article-model.js
    /your-app-path/patterns/article/article.html

Each controller requires at least one public function named `handler()`. The citizen server calls `handler()` after it processes the initial request and passes it two arguments: an object containing the parameters of the request and an emitter for the controller to emit when it's done.

The `args` object contains the following objects:

- `config` citizen config settings
- `content` The content object is the view context to which you append your pattern's content
- `request` The inital request object received by the server
- `response` The response object sent by the server
- `route` Details of the route, such as the requested URL and the name of the route (controller)
- `url` Any URL parameters that were passed (See "Routing and URLs" above)
- `form` Data collected from a POST
- `payload` Data collected from a PUT
- `cookie` An object containing any cookies that were sent with the request
- `session` An object containing any session variables
- `set` An object for you to set cookies, session variables, and redirects within your controllers

The server passes `args` to your controller, which you then modify as necessary (to append your view content or set cookies, for example) and then pass back to the server via the emitter.

In addition to having access to these objects within your controller, they are also passed to your view context automatically so you can use them within your Handlebars templates (more details in the Views section).

Based on the previous example URL...

    http://www.cleverna.me/article/My-clever-article-title/id/237/page/2

...you'll have the following `args.url` object passed to your controller:

    { id: 237, page: 2 }

Using these parameters, I can retrieve the article content from the model, append it to the view context, and pass the context back to the server:

    // article-controller.js

    exports.handler = handler;

    function handler(args, emitter) {
        // Populate your view context
        args.content.article = app.patterns.article.model.getArticle(args.url.id, args.url.page);

        // Emit the 'ready' event and pass the args object back to the server for rendering
        emitter.emit('ready', args);
    };

Here's a simple model:

    // article-model.js

    exports.getArticle = getArticle;

    function getArticle(id, page) {
        var articles = {
            '236': {
                title: 'I <3 Node.js',
                summary: 'Things I love about Node',
                pages: {
                    '1': 'First page content',
                    '2': 'Second page content'
                }
            },
            '237': {
                title: 'What\'s in room 237?',
                summary: 'Nothin\'. There\'s nothin\' in room 237.',
                pages: {
                    '1': 'Nothing to see here.',
                    '2': 'Actually, yeah, there is.'
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
            {{content.article.title}}
        </h1>
        <p id="summary">
            {{content.article.summary}}
        </p>
        <div id="text">
            {{content.article.text}}
        </div>
    </body>
    </html>



listener()
----------

The previous example has simple methods that return static content immediately, but things are rarely that simple. The `listener()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listener()` functions for very powerful asynchronous function calls.

`listener()` takes two arguments: an object containing one or more methods you want to call, and a callback to handle the output. `listener()` requires that your functions be written to accept an optional `args` object and an `emitter` object.

Let's say our article model has two methods that need to be called before returning the results to the controller. One is called getContent() and the other is getViewers(). Assume that getViewers() makes an asynchronous database call and won't be able to return its output immediately, so we have to listen for when it's ready and then react.

    // article-controller.js

    exports.handler = handler;

    function handler(args, emitter) {
        app.helper.listener({
            // The property name references the action you want to listen for, which is wrapped in an anonymous function
            article: function (emitter) {
                app.patterns.article.model.getArticle({ id: 237, page: 2 }, emitter);
            },
            // This property doesn't require an anonymous function because the only argument its function takes is the emitter generated by listener(), so you can just use the function name
            viewers: app.patterns.article.model.getViewers
        }, function (output) {
            // The property name you assign to the methods above becomes the name of the output object
            args.content.article: output.article;
            args.content.viewers: output.viewers;
            // Or just: args.content = output;

            // Emit `ready` now that we have the handler output and pass `args` back to the server
            emitter.emit('ready', args);
        });
    }

And the model:

    // article-model.js

    module.exports = {
        getArticle: getArticle,
        getViewers: getViewers
    };

    function getArticle(args, emitter) {
        var articles = {
            '236': {
                title: 'I <3 Node.js',
                summary: 'Things I love about Node',
                pages: {
                    '1': 'First page content',
                    '2': 'Second page content'
                }
            },
            '237': {
                title: 'What\'s in room 237?',
                summary: 'Nothin\'. There\'s nothin\' in room 237.',
                pages: {
                    '1': 'Nothing to see here.',
                    '2': 'Actually, yeah, there is.'
                }
            }
        };

        emitter.emit('ready', {
            title: articles[args.id]['title'],
            summary: articles[args.id]['summary'],
            text: articles[args.id]['pages'][page]
        });
    };

    function getViewers(emitter) {
        myFunction.that.gets.viewers( function (data) {
            // When the database returns the data, emit `ready` and pass the data back to listener()
            emitter.emit('ready', data);
        });
    };



Setting Cookies and Session Variables
-------------------------------------

In addition to the view context, the server's `ready` emitter also accepts an object called `set`, which is used for setting cookies and session variables.


### Cookies

You set cookies by appending them to `set.cookie`. Cookies can be set one at a time or in groups. The following code tells the server to set `username` and `passwordHash` cookies that never expire:

    // login-controller.js

    function handler(args, emitter) {
        app.helper.listener({
            login: function (emitter) {
                app.patterns.login.model.authenticate({
                    username: args.form.username,
                    password: args.form.password
                }, emitter);
            }
        }, function (output) {
            args.content.login = output.login;

            if ( args.content.login.success === true ) {
                args.set.cookie = {
                    // The cookie gets its name from the property name
                    username: {
                        // The cookie value
                        value: args.content.login.username,

                        // Valid expiration options are:
                        // 'now' - deletes an existing cookie
                        // 'never' - current time plus 30 years, so effectively never
                        // 'session' - expires at the end of the browser session (default)
                        // [time in milliseconds] - length of time, added to the current time
                        expires: 'never'
                    },
                    passwordHash: {
                        value: args.content.login.passwordHash,
                        expires: 'never'
                    }
                };
            }

            emitter.emit('ready', args);
        });
    };

The following code sets the same cookies, but they expire at the end of the browser session:

    args.set.cookie.username = 'Danny';
    args.set.cookie.nickname = 'Doc';

Other cookie options include `path` (default is `/`), `httpOnly` (default is `true`), and `secure` (default is `false`).

Cookies sent by the client are available in `args.cookie` within the controller and simply `cookie` within the view context:

    <!DOCTYPE html>
    <html>
    <body>
        <div id="welcome">
            {{#if cookie.username}}
                Welcome, {{cookie.username}}.
            {{else}}
                <a href="/login">Login</a>
            {{/if}}
        </div>
    </body>
    </html>

Cookie variables you set within your controller aren't immediately available within the `args.cookie` scope. citizen's server has to receive the response from the controller before it can send the cookie to the client, so use a local instance of the variable if you need to access it during the same request.



### Session Variables

If sessions are enabled, citizen creates an object called `CTZN.sessions` to store session information. You should avoid accessing this object directly and use `args.session` instead (or simply `session` within the view context), which automatically references the current user's session.

By default, the session has two properties: `id` and `expires`. The session ID is also sent to the client as a cookie called `ctzn_session_id`.

Setting session variables is the same as setting cookie variables:

    args.set.session.username = 'Danny';

To forcibly clear and expire a user's session:

    args.set.session.expires = 'now';

Like cookies, session variables you've just assigned aren't available during the same request within the `args.session` scope, so use a local instance if you need to access this data right away.



Redirects
---------

The `set` object is also used to pass redirect instructions to the server that are to be enacted after the request is complete. Redirects using `set` are not immediate, so everything your controller is asked to do, it will do before the redirect is processed. The user agent won't receive a full response, however. No view content will be sent.

The `redirect` object takes two keys: `statusCode` and `url`.

    args.set.redirect = {
        statusCode: 302,
        url: 'http://redirect.com'
    };



HTTP Access Control (CORS)
--------------------------

citizen supports cross-domain HTTP requests via access control headers. By default, all patterns respond to requests from the host only. To enable cross-domain access, simply add an `access` object with the necessary headers to your controller's exports:

    module.exports = {
        handler: handler,
        access: {
            'Access-Control-Allow-Origin': 'http://www.somesite.com http://anothersite.com',
            'Access-Control-Expose-Headers': 'X-My-Custom-Header, X-Another-Custom-Header',
            'Access-Control-Max-Age': 1728000,
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Methods': 'OPTIONS, PUT',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin'
        }
    };

For more details on CORS, check out this writeup on the [Mozilla Developer Network](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS).



Debugging
---------

If you set `mode: 'debug'` at startup, citizen dumps the current pattern's output to the console by default. You can also dump it to the view with the `ctzn_dump` URL parameter:

    http://www.cleverna.me/article/id/237/page/2/ctzn_dump/view

By default, the pattern's complete output is dumped to the console. You can specify the exact object to debug with the `ctzn_debug` URL parameter. You can access globals, `pattern`, and server `params`:

    // Dumps pattern.content to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/pattern.content

    // Dumps the server params object to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params

    // Dumps CTZN.session to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/CTZN.session

    // Dumps CTZN.session to the view
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/CTZN.session/ctzn_dump/view

In `development` mode, you must specify the `ctzn_debug` URL parameter to enable debug output. Debug output is disabled in production mode.



Helpers
-------

In addition to `listener()`, citizen includes a few more basic helper functions to make your life easier.

(docs coming soon)



Views
-----

citizen currently uses [Handlebars](https://npmjs.org/package/handlebars) for view rendering, but I'll probably add other options in the future.
