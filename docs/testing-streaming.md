# Streaming acceptance tests

Run the ordinary suite with `npm test`. It covers negotiation, SSE framing,
controlled drain/abort races, real HTTP streams and cancellation, body parsing,
and capture/exit errors. Existing buffered/cache tests run alongside it.

Optional integration fixtures skip when their external prerequisite is absent:

```sh
NGINX_BIN=/absolute/path/to/nginx npm run test:proxy
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
```

The proxy suite requires Nginx built with SSL and HTTP/2, plus OpenSSL for a
one-day local test certificate (`OPENSSL_BIN` can select its executable). It
starts isolated loopback HTTP and TLS HTTP/2 listeners, validates the configuration
with `nginx -t`, and removes processes, certificates, caches, and fixtures at exit.
No installed or production Nginx configuration is changed. The browser suite
uses a separate Playwright installation with Chromium available; it adds no
production dependency. Sandboxes must allow loopback listeners and browser launch.

Proxy coverage includes decoded delivery before EOF, the buffering hint and an
ignored-hint control, gzip, heartbeat/read timeout behavior, pre-handoff timeout,
client abort, error interception, proxy/Citizen upload limits, dual-format cache
mixing, HTTP/2 framing, UTF-8 Last-Event-ID, forwarded HTTPS, HEAD, 204, and POST SSE.
Negative controls intentionally demonstrate a buffered response, cached JSON
masking SSE, and proxy-generated/replaced errors.

The reusable native-browser checks are in `test/support/browser-contract.js`;
`test/support/stream-app.js` supplies the live Citizen routes. They verify actual
EventSource multiline data, Unicode IDs on reconnect, retry timing, 204 stop,
application completion-event closure, POST/fetch, and JSON error diagnostics.
These checks can also run through a connected Playwright browser against the
same disposable fixture.

Before release, run on Node 22.0.0 and the current supported development runtime,
and repeat the delivery/idle/abort tests through the application's real proxy or
CDN configuration. Local finish events and proxy acceptance do not prove that a
browser has consumed bytes. No production deployment is exercised by this suite.
