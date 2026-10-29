# First-class streaming responses

Target release: **2.0** (see [todo #17](../todo.md)).
Original ticket: [#140 — First-Class SSE Streaming API in Citizen](https://github.com/jaysylvester/citizen/issues/140).
Status: **Implemented and validated for 2.0 on 2026-10-28.**
Prepared: 2026-10-28, against branch `2.0` at `9d5c644` plus the existing
working-tree changes.
Scope updated: 2026-10-28 to include built-in SSE alongside generic streaming.
Review incorporated: 2026-10-28, against `5cc758e`, including the confirmed
5xx-only process-exit policy. Implementation remains part of this 2.0 update.
Scope narrowed: 2026-10-28 to separate streaming requirements and agreed bug
fixes from broader framework policy changes. Existing error details are retained.
Negotiation expanded: 2026-10-28 by agreement to use one media-type matcher for
ordinary and streaming dynamic responses, with documented compatibility changes.
Declaration precedence expanded: 2026-10-29 to allow an application-wide default
with controller/action overrides, using a streaming configuration object with
`enabled` and SSE heartbeat/retry defaults.
Proxy validation: 2026-10-28, a 24-case local Nginx probe against Citizen's current
manual-response path. Results and managed-feature acceptance requirements below.

## Goal and scope

Provide general streaming for notifications, job progress, live dashboards,
logs, generated exports, and model output. Citizen owns headers, backpressure,
cancellation, error handling, and completion hooks for every format.

Ship two layers together: a generic byte-stream core and built-in SSE support
that accepts structured events and handles framing, heartbeat comments, and
reconnection fields. Applications should not have to implement the SSE wire
format or manage heartbeat timers. Raw text, pre-encoded NDJSON, and binary
streams use the same core; a dedicated NDJSON serializer can follow separately.

Expand Citizen's existing content negotiation to match the endpoint's configured
representations and expose the selection through `response.contentType` before
the action runs. Applications should not parse Accept themselves to choose
between JSON and SSE. The same matcher serves ordinary dynamic responses.

Include the shared error-handler fix: `citizen.errors: 'exit'` applies only to
application (5xx) errors, across buffered, manual, and managed responses.
Repair empty JSON error output using Citizen's existing error information,
including messages and stacks. Do not introduce a generic-message replacement
or a production redaction policy in this feature.
Keep UTF-8 JSON parsing and reliable payload enforcement separately reviewable.
Streaming improves correctness and integration; it does not promise faster
delivery than an already-correct controller writing directly to Node's response.
Sinyu is an adoption example, not the feature's scope or release gate.

The ticket proposed imperative `initSse`, `sendEvent`, and `close` helpers. The
implemented API uses returned async iterables/Readables and an SSE descriptor so
Citizen owns response writes, backpressure, and cleanup. The
[README](../../../README.md#server-sent-events) covers token streaming, job
progress, application error/completion events, and adapting push producers.

### Scope boundary

| Category | Included in this update |
| --- | --- |
| Streaming correctness | Managed header/directive handoff, proxy buffering hint, backpressure, cancellation, completion, SSE mechanics, and response selection/body suppression for declared endpoints. Include proxy deployment guidance and acceptance coverage. |
| Agreed negotiation expansion | Match effective endpoint `contentTypes`, honor client preferences, use configured order for server preference, and retain explicit content-type overrides. This applies to ordinary and streaming dynamic responses. |
| Agreed existing fixes | Header-aware error handling, 5xx-only exit, nonempty JSON error output with existing diagnostics, UTF-8 JSON decoding, and payload-limit enforcement. |
| Proposed new API choices | Declaration placement, validation timing, descriptor/options, heartbeat defaults, and raw Content-Length support. These are design decisions, not existing defects. |

Preserve buffered/manual lifecycle behavior while applying the agreed shared
error/body fixes and negotiation changes. Moving every end hook to `finish`,
reordering all hook redirects before actions, changing error disclosure, and
generalizing early connection closure are separate proposals, not release prerequisites. The
implementation and acceptance tests below follow this boundary.

## Findings from the pre-implementation code

The original review's main concerns are supported by inspection. Its two
corrections are that manual responses do not automatically emit `responseEnd`,
and controller/action payload-limit overrides already exist. The plan review
identified additional lifecycle and error-policy gaps:

| Area | Current behavior | Consequence |
| --- | --- | --- |
| Controller ownership | `fireController()` awaits the action and later checks `writableEnded`. | An action that writes and ends can avoid normal rendering; returning while still open can enter normal header/rendering work. |
| Hook directives | Request-start headers apply immediately; session-start, request-end, and response-start headers apply after the action on the uncached path. Only request-start redirects currently short-circuit before the action. | Managed handoff must apply accumulated headers/cookies and resolve redirects before committing. Changing action execution order for all hooks is a separate behavior change. |
| Errors | The shared handler does not exclude `headersSent` or destroyed responses before rendering. Its async listener can reject under `captureRejections`. | A partially written response can enter error rendering; a handler rejection can re-enter without request arguments and fail again. |
| Exit policy | Both exit branches check only the effective `exit` policy, although the original CHANGELOG scopes it to 500 errors. | 4xx errors can terminate the process. This is a longstanding bug, not a new policy to introduce only for body parsing. |
| JSON errors | Without a layout, JSON errors have no rendered body. With a layout, the existing error context, including its message and stack, is serialized. | The missing JSON body contradicts the README. Preserve existing diagnostic fields when repairing it; stack output alone is not a streaming defect. |
| Disconnect | `serve()` calls `response.end()` on premature response close. | Later guarded writes stop, but upstream fetches and pending producers are not cancelled. |
| Completion | `responseEnd` is emitted explicitly by buffered responses, redirects, cache responses, and OPTIONS handling. | A manually ended response does not automatically run the end hook or its access logging. |
| JSON | Every body uses `StringDecoder('binary')`; JSON's media type is matched exactly. Parse errors have no 400 status and fall through to `requestEnd`. | Unicode/charset JSON is mishandled; malformed JSON becomes a client-triggered 500, can exit the process, and can still invoke the controller under capture. |
| Body limits | The parser requires `Content-Length < maxPayloadSize` and repeats that strict comparison during accumulation. | Chunked uploads, bodyless DELETE requests without Content-Length, and bodies exactly at the limit are rejected. |
| Controller limits | `extendConfig()` runs before body parsing, merging `config.controller` followed by `config[action]`. | Per-controller and per-action `forms.maxPayloadSize` already work. Document and test them rather than adding another setting. |
| Negotiation | A hardcoded Accept switch runs before controller/action config is applied, mapping SSE and wildcard requests to `text/plain`. Later allowed-type checks do not select another acceptable representation. | Use the endpoint's effective offered types before invoking the action, so it can branch on the negotiated format. This expands shared negotiation rather than adding an SSE-only fallback mechanism. |
| Bodyless responses | A 204 with `view: false` still reaches layout/encoding work, and the allowed-type guard precedes rendering. | Declared endpoints need a bodyless fast path before final format validation. A framework-wide bodyless-path rewrite is not required. |
| HEAD | Several static/cache paths test `request.headers.method` instead of `request.method`. | This is an existing bug, but unrelated static/cache repairs are not streaming prerequisites. Use `request.method` in the managed path. |

References: [server lifecycle and parsing](../../../lib/server.js),
[response hooks](../../../lib/hooks/response.js),
[configuration defaults](../../../init/config.js), and the existing override
test in [config.test.js](../../../test/config.test.js).

Node's `requestTimeout` concerns receiving the request, not response duration
afterward. Its socket inactivity timeout defaults to disabled. No timeout-default
change is required; see [Node's HTTP documentation](https://nodejs.org/download/release/v22.0.0/docs/api/http.html#serverrequesttimeout).

## Public contract

### Shared content negotiation

Replace the hardcoded media-type switch with matching directly in `serve()` in
`lib/server.js`, used for all dynamic requests. Match against the effective
entry endpoint's `contentTypes` using global -> controller -> action precedence,
including the existing array-replacement behavior. Read the offered list before
initial negotiation without moving all configuration merging, changing hook
execution order, or changing configuration inheritance down a controller chain.
Keep the default configured list unchanged; adding SSE support does not globally
declare every endpoint capable of returning it.

Set `response.contentType` to the selected configured representation before
hooks and the initial action run. Match configured media types generally, so
SSE, pre-encoded NDJSON, and binary downloads do not each need another hardcoded
case. Configured entries are bare `type/subtype` strings, without wildcards or
parameters. Return the selected configured string, not the client's spelling
or full media range, so the existing configured-type guard compares the same
value. Negotiation selects a representation; buffered rendering or a returned
stream determines how to produce it. Listing a type does not add a serializer.
Static-file type selection and Accept-Encoding/compression negotiation remain
outside this change.

Match type/subtype case-insensitively, with quality weights, wildcards, and
specificity. For each offered representation, the most specific matching range
determines its quality; exclude quality zero before comparing candidates. A
broader wildcard cannot resurrect a specifically excluded type. Rank remaining
candidates by **quality, matching-range specificity, client order, then configured
order**. Specificity ranks exact types above `type/*` above `*/*`; client order
means the matching range's position in Accept. Keeping client order ahead of
configured order preserves existing explicit equal-weight preferences. It is a
Citizen compatibility policy, not an HTTP requirement. With no Accept header,
an empty or whitespace-only value, or an unrestricted `*/*`, select the first
offered type. An omitted header
expresses no client preference; it is not an explicit request for HTML.

This release negotiates bare media types, not parameter-based variants. Parse
the parameter list and recognize `q` regardless of its position; ignore other
parameters for matching and ranking. For example, `v=b3` in a browser's
`application/signed-exchange;v=b3;q=0.7` range must not obscure its weight or
invalidate the rest of Accept. Document this as a limitation: HTTP media-type
parameters can constrain a match and affect specificity, so this is not complete
parameter-aware matching. See
[RFC 9110, Accept](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.1).

An absent `q` means 1. Accept standard qvalues from 0 through 1 with up to three
fractional digits, including `q=1.0` and `q=1.000`. Retain the existing tolerance
for an omitted leading zero, such as `q=.5`, with one to three fractional digits;
document it as a compatibility extension to the
[qvalue grammar](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.4.2).
Skip an entire malformed range or range with an invalid weight; do not silently
turn an invalid weight into 1. Examples include out-of-range, nonnumeric, or
overprecision values. If no acceptable candidate remains, retain the unmatched
outcome below. Client syntax must not cause an application 500.

For `contentTypes: ['application/json', 'text/event-stream']`:

| Accept | Negotiated type before the action |
| --- | --- |
| `text/event-stream` | `text/event-stream` |
| `application/json` | `application/json` |
| `text/event-stream;q=0.5, application/json;q=1` | `application/json` |
| `text/*` | `text/event-stream` |
| `*/*`, omitted, or blank | `application/json` |
| `application/json;q=0, */*;q=1` | `text/event-stream` |
| `text/html` | No acceptable representation |

Also test Citizen's unchanged default offered list, in order:
`text/html`, `text/plain`, `application/json`, `application/javascript`.
These cases must not rely on JSON already being the first configured type:

| Accept | Negotiated type before the action |
| --- | --- |
| `application/json, text/plain, */*` (Axios default) | `application/json` |
| `application/json, */*` | `application/json` |
| `text/plain, application/json` | `text/plain` |
| `application/json, text/plain` | `application/json` |
| `*/*`, omitted, or blank | `text/html` |

Keep an unmatched outcome distinct from a chosen type: leave
`response.contentType` undefined until an application override supplies one.
Do not substitute `text/plain`, perform a cache lookup with an unresolved type,
or reject before hooks/actions can use Citizen's existing explicit override.
At the normal response validation point, return a nonfatal 406 if no acceptable
representation or valid forced type exists. Redirects, errors, and the declared
endpoint's bodyless fast path retain their separate handling. The shared
error-format rule below covers unresolved types and types without a buffered
renderer for every error status, including errors raised before the action.
Do not recursively negotiate diagnostic bodies or replace an original error's
status with 406 because its selected type cannot render that error.

If an ordinary buffered return requires a renderer unavailable for its selected
type, report a contract 500 rather than an empty success. Managed streams,
manually handled responses, and supported bodyless responses do not require
that renderer. Renderer lookup must recognize media types case-insensitively,
while the public `response.contentType` retains the configured string above.

Preserve hooks/controllers assigning `response.contentType` regardless of Accept,
subject to the existing configured-type validation. Do not overwrite that choice
with a later negotiation pass. Retain explicit Content-Type header precedence
and existing cache timing/keys, using the selected or hook-forced type at each
existing lookup point; general forced-format cache policy remains separate.
An SSE descriptor must agree with the selected or explicitly forced type. It
selects the encoding and source, not a silent override from JSON to SSE. To
force SSE, an action can explicitly set `response.contentType` just as it can
force JSON. A descriptor/type mismatch after a valid selection is a contract
500; an unresolved client mismatch is a 406, with any returned source disposed.

Document these compatibility changes for existing dynamic endpoints:

- With the default offered list, `*/*` now selects HTML instead of the old
  plain-text fallback. An omitted header still selects HTML with that default
  list, but a JSON-only action now selects JSON from its own effective list.
- If a preferred type is unavailable, a lower-weight acceptable offered type
  can be selected instead of failing the later type guard. No acceptable match
  yields 406 rather than a plain-text fallback; a wildcard respects explicit
  quality-zero exclusions.
- Preserve explicit equal-weight client order after specificity: Axios's default
  Accept and `application/json, */*` still select JSON on Citizen's default list.
- Configured order determines the default. Put JSON first on a dual-format
  endpoint to make an unspecified preference return a finite snapshot; an
  SSE-only endpoint naturally defaults to SSE. Show explicit Accept headers in
  fetch/curl examples and distinguish `*/*` from omitting the header, while
  documenting that both use the server preference under the new matcher.

### Declaration and return value

The following declaration and validation rules are proposed API choices. The
required invariant is that stream eligibility and cache bypass are known before
cache lookup and before consuming a returned source.

Use a `streaming` configuration object with defaults
`{ enabled: false, sse: { heartbeat: 15000, retry: false } }`. Resolve its fields
from `config[action]`, then `config.controller`, then the application default
`citizen.streaming`. Partial objects inherit omitted fields. Check application
and supplied controller/action settings at request dispatch, before any relevant cache
lookup: objects must be plain, `enabled` must be boolean when supplied, and
SSE options must satisfy the constraints below. Resolve each target against the
application default, not inherited chain configuration; validate include and
`next` targets when selected, including after controller reloads. Local
`enabled: false` values opt out of the global default, and an action can override
a controller's opt-out.
Enabling streaming permits both streamed and buffered returns, applying managed
lifecycle and cache bypass to enabled entry requests. Static assets are unaffected.
Separate early resolution from dispatch rejection: only an effective boolean
true, with every supplied settings object valid, installs the managed lifecycle.
If either supplied settings object is invalid, treat the endpoint as undeclared
during early setup and retain the invalid result for the contract 500 at dispatch,
before cache lookup/action execution. Do not install managed listeners or a
signal merely because a malformed value is truthy.
Keep existing config merging: a merged `params.config.citizen.streaming` value
may be visible as informational configuration, but it does not declare a later
action. Hold the authoritative per-action declaration in private request state.
Whole-config startup validation belongs to [Consider #24](../todo.md), including
these streaming settings. Do not add streaming-specific validation to config
initialization; runtime stream checks remain local to dispatch and preparation.

A declared entry endpoint bypasses all request/action cache lookup and insertion
for that request, including ordinary buffered fallbacks and their nested work.
On an otherwise buffered request, a declared include or `next` target still
bypasses its action cache; it may return buffered output, but an actual stream
there is rejected and disposed. The buffered parent's cache policy is unchanged.
Ignore inherited hook cache directives on declared endpoints; reject an explicit
cache directive returned by a declared action even on a buffered fallback.

The declaration matters because Citizen checks caches before invoking the
action. Detecting a stream only in its return value cannot prevent an existing
buffered entry from skipping the action. Keep cache keys and deferred general
cache policies outside this feature.

Illustrative dual-format job-progress action: JSON is the default, and the
action branches on the negotiated `response.contentType`. `prepare()` checks
access, validates the job, and completes fallible setup before returning a source.
`events()` yields records such as
`{ event: 'progress', id: '42', data: { completed: 75 } }`.
Citizen serializes the data and formats the event:

```js
export const config = {
  handler: {
    streaming: { enabled: true },
    contentTypes: ['application/json', 'text/event-stream']
  }
}

export const handler = async (params, request, response) => {
  // No match: let Citizen return 406 without starting application work.
  if ( response.contentType === undefined ) return {}

  let job = await app.models.jobs.prepare(params.url.id, {
    session: params.session,
    signal: request.signal
  })

  if ( response.contentType === 'application/json' ) {
    return { local: await job.snapshot() }
  }

  if ( response.contentType === 'text/event-stream' ) {
    return {
      stream: {
        format: 'sse',
        source: job.events({
          signal: request.signal,
          after: request.lastEventId
        }),
        heartbeat: 15000,
        retry: 3000
      }
    }
  }
}
```

Authorize access before returning the source. Use controller setup or the
existing request-start short-circuit when action side effects must be prevented;
later hook redirects are resolved at handoff before streaming bytes. Existing
hook/action ordering is retained. The application decides how to resume from
`after`. These option names and defaults are implemented.
Citizen writes the SSE UTF-8 Content-Type header for the selected format;
no manual response header or timer code is required.
Application response hooks still supply security and cache policy, including
CSP and `X-Content-Type-Options`.

- Accept `{ stream: source }`, where the source is a Node `Readable` or an async
  iterable, for raw streaming. Accept the source directly as shorthand. This
  includes a Web `ReadableStream` through Node's supported
  [async-iterator interface](https://nodejs.org/download/release/v22.0.0/docs/api/webstreams.html#async-iteration);
  it does not imply support for Web `Response`. Reject sync-only sources such
  as arrays, strings, and Buffers; strings and byte arrays are chunks, not sources.
- Also accept `{ stream: { format: 'sse', source, ...options } }` for structured
  SSE. Normalize both forms into the same writer lifecycle. Recognize a source
  by its stream/iterator interface before considering descriptor fields; reject
  invalid descriptors and unsupported formats explicitly.
- Raw mode accepts string, `Buffer`, and `Uint8Array` chunks, encoding strings as
  UTF-8 and preserving bytes. It does not serialize objects. SSE mode accepts
  event records from async iterables or object-mode Readables and encodes them
  before passing bytes to the writer. Never infer SSE from arbitrary objects or
  a raw stream's Content-Type header; raw mode remains a deliberate escape hatch.
- Keep the controller signature, `response.statusCode`, `response.contentType`,
  and `header`, `cookie`, and `session` directives. On declared entry endpoints,
  add `request.signal` before hooks/controller setup for cancellation of
  application I/O. Other endpoints retain their existing cancellation behavior.
- Detach the source/descriptor before context merging, copying, route-chain
  snapshots, debug inspection, or cache handling. Hold it and the abort controller in
  private request state. Do not expand `helpers.copy()` to clone streams or
  arbitrary class instances.
- In v1, a stream is terminal output from the initially requested action. Skip
  view rendering, includes, `next`, default layout, JSON/JSONP wrapping, and debug
  body injection. Reject a stream combined with returned `include`, `next`, a
  rendered view, cache directives, or a refresh redirect; `view: false` is
  harmless. Permit `local` as ordinary metadata for hooks, never as an additional
  body or an implicit SSE event. Ignore inherited rendering/chain directives
  when a stream takes ownership; reject explicit incompatible action directives.
- Reject streams from includes/later chain actions or undeclared endpoints
  before consumption, and dispose rejected sources. Ordinary buffered returns
  remain supported on declared endpoints.
- A managed action must not write, end, or flush the response itself. Detect
  already-committed/ended responses at handoff, dispose the source, and report
  the contract error without another write. Manual response ownership remains
  available for compatibility.

Stream contract violations are application errors (500): invalid declarations
or descriptors, unsupported placement, conflicting headers, and prohibited
directive/status combinations. They retain the normal capture/exit policy.
Client input/format rejections use their appropriate 4xx status. A failed type
check caused by an invalid stream contract must not be mislabeled a client 406.

Defer additional format helpers, Web `Response` objects, streaming templates,
compression, and streaming request-body APIs. A source
implementing the accepted async-iterator contract needs no additional adapter
API. SSE is included in the initial feature, not deferred to application code.

### Built-in SSE support

Keep the serializer and SSE scheduling in a small internal module such as
`lib/sse.js`. It feeds the common writer rather than owning a second response
lifecycle. The agreed responsibility split is:

| Concern | Citizen provides | Application decides |
| --- | --- | --- |
| Framing | Encoding, field validation, multiline handling, and data serialization. | Event names and payload schemas. |
| Heartbeats | Comment emission, configurable timing, backpressure coordination, and timer cleanup. | Interval overrides or disabling them. |
| Reconnection | Retry fields and access to the client's last event ID. | ID assignment, retained history, replay, authorization, and resumability. |
| Completion | Response closure, cancellation, cleanup, and hooks. | Meaning of completion and any final application event. |
| Errors | Safe transport termination and logging. | Public error events and application recovery. |

#### Event records and serialization

Accept records with `data`, `event`, `id`, `retry`, and/or `comment`; require at
least one supported field and reject unknown fields. Require string values for
`event`, `id`, and `comment`. Encode UTF-8 frames with correct field prefixes and
a terminating blank line. Support multiline/empty data and comments, treating
CRLF, CR, and LF as line separators. Reject line breaks in single-line metadata
and NUL in IDs rather than allowing field injection. Preserve empty IDs and
`retry: 0`; omission must remain distinct from an empty/zero value. Support
comment-only, ID-only, and retry-only control records without inventing a data
event. These encoding rules follow the
[SSE wire format](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).

Default serialization: preserve string data; JSON-serialize other
JSON-compatible values, including null, using `JSON.stringify()` semantics for
nested values. An optional `serialize` function may replace data serialization
and must return a string. Explicit undefined data, a non-string serialization
result, circular data, and serializer failures are errors, not silently dropped
events. A missing `data` field is valid for control records.
SSE sources yield records, not already-framed strings; applications proxying an
existing wire stream use raw mode. Do not log data or retain completed frames.

#### Heartbeats

Use `streaming.sse.heartbeat` to default comment heartbeats to 15000 ms without a
write, with a
positive integer millisecond override within Node's supported timer range, or
`false` to disable it. This default follows the standard's approximate
[15-second keepalive guidance](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes);
deployments can choose a shorter interval for their proxy's idle limit.
Application, controller, and action settings merge per field; a descriptor's
explicit `heartbeat` overrides them. `false` disables heartbeats. These defaults
are consumed only by managed SSE, never raw streams or buffered returns.

Start scheduling only after committing an actual SSE response. Emit comments
through the same serialized writer as events, including while a producer is
awaiting its next item. Keep at most one pending source pull; a heartbeat winning
a timer race must not issue another `next()` or discard the pending result.
Never interleave a comment inside an event. During backpressure, stop writing
and coalesce/drop missed heartbeat ticks instead of queuing them. Data writes
reset the idle timer. Cancel timers on completion, redirect, body suppression,
error, and disconnect; ordinary buffered fallbacks get no heartbeat timer.

Heartbeats cannot overcome a blocked connection, proxy buffering, or an absolute
client deadline. Document those deployment limits without requiring applications
to duplicate the heartbeat implementation. They also cannot cover controller
setup before handoff: no SSE bytes are committed before validation completes.
Budget setup against the proxy's upstream read timeout. Raw streams receive no
synthetic heartbeat bytes; their allowed idle time is a deployment concern.

#### Reconnection and completion

The `retry` option emits an initial retry control record before source
events; later event records may change it. Default `streaming.sse.retry` to
`false`, meaning no initial retry directive. Accept nonnegative safe integer
milliseconds, including zero. Resolve application/controller/action defaults per
field, with explicit descriptor values taking precedence; descriptor `retry: false`
suppresses an inherited directive without disabling client reconnection. Event
record retry values remain nonnegative integers; false is only a settings value.
On declared entry endpoints, expose `request.lastEventId` as an opaque string
before the action runs, using null for an absent header and preserving an
explicitly empty value. Elsewhere expose null without parsing or rejecting the
header. Node exposes header bytes as latin1 strings: recover them with
`Buffer.from(value, 'latin1')`, then decode with a fatal UTF-8 `TextDecoder`
that preserves a leading BOM (`ignoreBOM: true`). Reject malformed UTF-8 with
400 before invoking the action; do not silently replace bytes, trim, or coerce
IDs to numbers. An emitted non-ASCII ID must round-trip through reconnection.
Treat it as untrusted input, never authorization. Do not generate IDs, keep a
replay buffer, or rerun application work automatically. See the standard's
[Last-Event-ID contract](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header).

Source exhaustion closes the response and clears timers. Do not append a magic
`end`, `done`, or `[DONE]` record. Browser EventSource normally reconnects after
EOF; applications can send a named completion event whose client calls
`EventSource.close()`, or return HTTP 204 on a connection request to stop retries.
An already-committed 200 cannot become 204. See
[EventSource processing](https://html.spec.whatwg.org/multipage/server-sent-events.html#processing-model).

Document native EventSource's GET-based connection separately from POST/fetch
consumers. Citizen can encode SSE for either, but a fetch consumer needs its own
parser and reconnect policy. `retry` concerns client reconnection, not retrying
an upstream operation. A client library, durable replay store, and broadcast
service are outside this feature.

An open stream does not extend a session's lifetime. Keep the existing
request-time extension and expiry/session-end behavior, including expiry during
a stream. A producer's `params.session` reference is not evidence that the
session remains live. Document application revalidation and cancellation where
continued authorization is required; automatic session keepalive is out of scope.

## Response lifecycle implementation

### 1. Prepare headers and take ownership

Add a small internal writer, for example `lib/stream.js`, shared by raw streams
and the SSE adapter. Keep routing, directive interpretation, and hooks in
`lib/server.js`.

At managed handoff, apply accumulated hook and controller headers, session
changes, and cookies before flushing or pulling the source. Preserve existing
controller precedence and case-insensitive header handling. Build `Set-Cookie`
from the complete accumulated cookie context, including a new session cookie;
do not replace it with only the last controller's cookies. There is no need to
move directive application before every action or cache response to achieve this.

Resolve accumulated server-side redirects before starting the stream, disposing
the source without pulling. Honor these redirects for managed direct requests
as well. Preserve existing hook/action execution order; a later hook redirect
does not newly prevent the action from running. Reject a managed stream combined
with a refresh redirect; ordinary buffered refresh behavior is unchanged.
Reuse server-side directive handling rather than putting redirect rules in the
writer. The broader [direct-request redirect repair](../open/direct-request-redirects.md)
remains separately tracked; this plan changes managed handoff without reordering
ordinary hooks/actions.
The current `setRedirect()` gate at `server.js:1399` skips direct requests, so
managed handoff must call `redirect()` with the same referrer behavior or pass
an explicit managed-path flag through the shared helper. Reusing it unchanged
would retain the bypass.

Manual writers retain their existing ownership responsibilities, including
applying headers/cookies before their own writes. Adopting the managed contract
provides the prepared handoff. Existing early redirects before body consumption
also retain their current connection behavior; generalizing the payload-overflow
close policy to all early responses is outside this update.

Use the shared negotiation result or an explicit application override; do not
introduce a second SSE-specific matcher or implicit JSON-success fallback.
Normalize and detach the returned source/descriptor before ordinary context
processing, then validate the final representation at handoff. Raw streams
honor `response.contentType` and existing explicit-header precedence. An SSE
descriptor requires a final `text/event-stream` representation; Citizen writes
`text/event-stream; charset=utf-8` and rejects conflicting Content-Type overrides.
The descriptor must not silently replace a negotiated or forced JSON type.

Successful ordinary buffered returns use the negotiated or forced buffered
format. If SSE was selected, the action returns an SSE source, a supported
bodyless response, or deliberately forces an allowed buffered type. An ordinary
object is not implicitly turned into SSE or JSON. An unresolved client mismatch
gets 406 before source consumption; invalid stream contracts or a buffered return
requiring an unavailable renderer get 500. Dispose rejected sources, and retain
the action's opportunity to force a supported type before either decision.

Pre-commit SSE errors follow the shared error-format rule below, retaining the
message and stack in JSON without requiring a view or layout. Native EventSource
does not expose this JSON body as an event; fetch consumers can read it.

For SSE event bodies, use HTTP 200 for native EventSource compatibility; permit
a bodyless 204 to stop reconnection. Reject other SSE descriptor statuses before
commit. Ordinary HTTP validation responses use the buffered path; error responses
use the error renderer described below, retaining diagnostic details.
The raw-stream path retains ordinary status handling.

A stop-reconnection action on a declared endpoint sets `response.statusCode = 204`
and returns `{ view: false }`, without constructing a source. For declared
endpoints, handle final bodyless statuses after applicable directives/redirects
but **before** final allowed-type/406 validation: a 204 has no body
format to validate. Skip `next`, includes, layout, encoding, and cache insertion;
dispose any source without pulling it. This works on an SSE-only endpoint with
compression and a default layout enabled. Stream contract validation still
applies. For HEAD with a source, use `request.method`, apply metadata, and dispose
without pulling. Leave unrelated buffered/static bodyless-path repairs separate.

For managed streams:

- After applying directives, default `X-Accel-Buffering` to `no` if the application
  has not supplied it, using a case-insensitive header check. Set this only when
  an actual managed stream takes ownership, before flushing; do not apply it to
  every declared endpoint's buffered fallback, error, redirect, or bodyless return.
  Preserve explicit application overrides. This is a proxy hint, not a guarantee:
  Nginx can ignore it, and other proxies have their own controls. Nginx normally
  consumes this header, so browser-visible header inspection is not a delivery
  test. See the reverse-proxy requirements and probe results below.
- Default `Cache-Control` to `no-store` only when the application has not set it.
  Do not synthesize an ETag or perform conditional 304 handling.
- Bypass `renderOutput()`, `respond()`, and `encodeOutput()`. Use identity bytes
  even when Citizen compression is enabled/forced. Reject explicit non-identity
  `Content-Encoding` and `Transfer-Encoding` before commit; Node owns transfer
  framing. Reject `Content-Length` for SSE, whose heartbeats affect byte counts.
  For raw downloads, accept a valid nonnegative safe-integer Content-Length and
  count encoded bytes: prevent overrun writes and treat premature exhaustion as
  a stream failure. Known-size exports retain download progress information;
  unknown-size streams omit the header. Test exact/under/over lengths, multibyte
  strings, and zero; HEAD/bodyless suppression must not trigger an underflow.
  See Node's [length-checking support](https://nodejs.org/download/release/v22.0.0/docs/api/http.html#responsestrictcontentlength).
- Flush headers after validation/directives, before the first potentially slow
  iterator pull. This intentionally commits the status before producer errors,
  including failure before its first chunk. Fallible setup requiring an HTTP
  error status belongs in the action before returning the stream. Keep immediate
  flush rather than introducing a first-item timeout: an idle notification
  source may have no first event for an arbitrary duration. Make the example's
  preparation pattern prominent, since a failing first pull after 200 can cause
  repeated EventSource reconnections; the framework cannot infer which upstream
  failures should stop retrying.
- For HEAD and final bodyless statuses such as 204/304, send no chunks, never
  pull the source, and dispose it. Start no heartbeat or retry output. The action
  may still run to establish headers; producers should acquire expensive
  resources lazily and honor cancellation.

### 2. Respect backpressure and cancellation

Pull one chunk/event at a time. When `response.write()` returns false, stop
pulling until drain; also settle that wait on error, premature close, or abort.
SSE heartbeats share this flow control, including preserving any already-pending
source pull. Add no whole-stream buffer or unbounded queue. See Node's
[write/drain contract](https://nodejs.org/docs/latest-v22.x/api/stream.html#event-drain).

Create the AbortController and cancellation/completion state together for a
declared entry endpoint, before hooks/controller setup. The writer consumes this
existing signal at handoff. Abort on an incomplete incoming request or premature
response close. An ordinary incoming request close after receiving its body must
not cancel the response; see
[Node's incoming-message close semantics](https://nodejs.org/download/release/v22.0.0/docs/api/http.html#event-close_3).
Use the new close handler instead of the legacy `response.end()`-on-close handler
for declared requests; do not run both. Other requests keep their existing
lifecycle. Distinguish normal finish from premature close and never end a
destroyed response in the new path.

These guarantees apply to Citizen's immediate peer. Behind a proxy, buffering
can let the producer advance ahead of the browser, and browser cancellation
reaches Citizen only when the proxy closes its upstream connection. Do not
describe local drain/finish as browser consumption or promise cancellation
through a proxy configured to continue upstream work after client disconnect.

Record the cause before aborting during cleanup: a client disconnect is
cancellation, while a producer/application failure remains a failure. Neither
`signal.aborted` plus a closed response nor an error named AbortError alone
establishes cancellation. Suppress abort/destroy errors caused by a known
disconnect, without invoking the application error hook or exiting. Preserve
genuine 5xx reporting and exit decisions when failure cleanup also aborts the
signal. This covers setup and buffered fallbacks on declared endpoints as well
as active streams, without adding a signal contract to every existing endpoint.

On cancellation/failure, stop writes, abort the signal, destroy a Node Readable
or call the iterable's `return()`, and release listeners. Cover disconnects
during setup, pending `next()`, drain, and final flush. Observe late rejections
and dispose a source returned after the request has already closed.

For declared requests, continuations after awaited hooks/controllers check the
closed state and signal before mutating headers or advancing the lifecycle.
In particular, update the existing `writableEnded`-only gates in `fireController()`
before header work (`server.js:1177`) and after redirects (`1196`), at `next()`
entry (`1340`), and before writes in `respond()` (`1534`). `writableEnded` can stay
false after the new close handler observes a destroyed response without ending
it. Check private closed/cancellation state and `response.destroyed` as well as
`writableEnded`; do not advance abandoned buffered fallbacks. These line numbers
refer to `5cc758e`. The pre-commit error path may still produce its diagnostic
response while writable; aborting failure cleanup must not suppress that path.

Cancellation is cooperative: an arbitrary await inside a generator cannot be
forcibly interrupted. Producers must forward the signal upstream and use
`finally` for cleanup. Completion must not wait forever for an uncooperative
producer or its `return()`; observe cleanup promises without allowing unhandled
rejections. Avoid blindly piping into the HTTP response if that prevents
Citizen's pre-commit error handling; Node documents
[pipeline's destination-destruction behavior](https://nodejs.org/docs/latest-v22.x/api/stream.html#streampipelinesource-transforms-destination-callback).

### 3. Make errors safe and restrict exit to 5xx

Make the shared error handler header-aware, including for manual responses:

- Retain the existing nested-rendering short-circuit. A small catch at the error
  listener reports unexpected handler failures, closes unfinished responses,
  and completes managed cleanup without invoking hooks or rendering again.
  Keep request context and the effective exit policy in that catch; do not add
  a second diagnostic response renderer.
- Before commit, use the ordinary error path while the response is writable.
  Whenever Citizen is going to render an error body and the selected type is
  unresolved or lacks a buffered renderer, use the repaired JSON error renderer.
  This applies to all error statuses and entry points, including a missing-route
  404, a pre-action 413, hook failures, and errors after selecting SSE, NDJSON,
  CSV, or another stream type. Preserve the original status, message, and stack;
  bypass the endpoint's success-format guard and do not negotiate again.
  Set the diagnostic Content-Type and remove incompatible transport headers.
  Use this fallback without requiring an application view or layout. Existing
  body suppression, reporting-only, cancellation, and fatal-exit rules still
  determine whether any body is sent; never apply the fallback after commit or
  to a closed response. Retain supported ordinary error formats and valid
  error-hook overrides.
- Repair the missing JSON error output by rendering the existing error context
  when an error body is appropriate. Preserve its field/namespacing conventions,
  message, stack, and existing layout behavior for ordinary JSON responses.
  Cover the shared JSON/JSONP serialization path. The generalized JSON fallback
  uses the same error information without requiring an application view/layout.
  If raw error metadata cannot be serialized, retry at the serialization site
  without that raw field, preserving the original and serialization-error stacks,
  JSON/JSONP formatting, and layout output. Ordinary output serialization failures
  remain errors.
  Keep full errors available to logging and the application error hook. Stack
  redaction, a new error schema, and generic replacement messages are not part
  of this repair; normal fatal-exit behavior still need not render a body.
- After commit, log once and call the application error hook only for 5xx;
  never change status, set headers, or render an error view. Cancel the source
  and destroy the response on unexpected stream failure so truncation is not
  presented as successful completion. Terminate promptly even if the error hook
  awaits slow work, and recheck response state after any awaited hook.
- Use the recorded termination cause to distinguish disconnect cancellation
  from genuine failures. Suppress resulting duplicate abort/destroy reports;
  never infer that all errors on an aborted, closed response are cancellation.
  Never write to a closed response.
- Correct the shared exit rule for every request path, not just streaming or
  body parsing. Compute `shouldExit` from the effective policy
  (`err.result || params.config.citizen.errors`, with a safe global fallback)
  **and** `statusCode >= 500 && statusCode < 600`. Use it in both exit branches and
  the reporting-only status-assignment guard (`respond || shouldExit`), subject
  to response writability/commit checks. An unspecified error status remains
  500. An explicit `err.result: 'exit'` cannot make a 4xx fatal; a 5xx capture
  override still prevents exit.
- 4xx errors never invoke the application server-error hook or exit under either
  policy, whether the response is open, committed, or ended, including reporting
  with `respond: false`. A separate failure while handling a 4xx can still be a
  genuine 5xx. Expected disconnects remain cancellation, not 500s. Apply the
  same 5xx classification to logging, the application hook, and exit decisions.
- Preserve fatal exit for genuine 5xx under `exit`, including committed stream
  failures. This repairs the original contract documented in the
  [1.0 CHANGELOG](../../../CHANGELOG.md); it is not a streaming exemption.
  Clarify the README configuration table and Capture vs Exit section. Startup
  failures such as bind/certificate/configuration errors are outside this HTTP
  status policy. Test real exit decisions in child processes.
- Applications may catch expected upstream errors, yield a structured SSE error
  event (or their own raw protocol record), and finish normally. Citizen formats
  the record. It does not invent an application error event or append a diagnostic
  body to an already-committed stream. Stack details remain available to logs/hooks;
  applications control their own error events. SSE failures use the same
  pre-/post-commit error rules and clear heartbeat state. Error hooks that write
  must respect `headersSent` and the closed state.

### 4. Complete managed responses once

Use the declared request's private completion state and latest params/context.
Once a stream or the declared endpoint's bodyless fast path takes ownership,
call `end()` once on success and emit `responseEnd` on finish. On failure or
premature close, finalize without waiting indefinitely for setup/producer work.
Set the guard before invoking the hook; a subsequent close, late controller
return, or hook failure must not complete or reopen the response again.

Integrate the guard with existing explicit end-hook emissions on declared
requests, so a pre-handoff redirect, buffered fallback, or setup error completes
once at its existing call site. A disconnect during pending setup can finalize
that declared request before a source exists. A declared endpoint's buffered
fallback cancelled during an await still runs the end hook once with cancellation
state; resumed normal work must not run it again or log a success. Keep ordinary
buffered/cache, OPTIONS, and manual completion behavior and timing intact; do not
migrate all responses to `finish`. In particular, retain buffered `respond()`'s current
end-hook order relative to `cacheRoute()`.

For deliberate fatal exit during a managed request, invoke its guarded
completion path before exiting; do not promise to await asynchronous end-hook
work after a fatal exit decision. Finish means handed to the operating system,
not acknowledged by the client; see
[Node's finish event](https://nodejs.org/download/release/v22.0.0/docs/api/http.html#event-finish_1).
Managed end hooks can inspect completion state and the cancellation signal.
Do not log managed cancellations/failures as successful access records or log
their chunks. Document the new managed lifecycle, without promising new end
hooks for every existing manually owned response.

## Request-body repair

Implement independently of the streaming writer:

1. Normalize media type and parameters. Parse bare `application/json` and its
   UTF-8 charset form with case-insensitive type/charset handling. Reject an
   explicitly unsupported JSON charset with 415; leave additional `+json` media
   types for a separate decision.
2. Decode JSON with a fatal UTF-8 `TextDecoder`, retaining split characters and
   flushing at end. Reject malformed UTF-8/JSON with a fixed 400. Node's
   [TextDecoder API](https://nodejs.org/download/release/v22.0.0/docs/api/util.html#class-utiltextdecoder)
   supports incremental decoding and fatal errors. Keep `request.payload` as
   decoded text, `params.payload` as the parsed value, and existing empty-body
   behavior (`params.payload` remains `{}`).
3. Preserve multipart's binary/latin1 representation and uploaded bytes, and
   existing URL-encoded behavior. Do not blanket-convert multipart to UTF-8.
   Body parsing remains bounded and buffered.
4. Count bytes before decoding. Accept `bytes <= maxPayloadSize`; reject larger
   bodies with 413. Use Content-Length only for early rejection when present;
   enforce actual byte counts for all bodies, including chunked requests. An
   absent Content-Length is not an overflow: accept a bodyless DELETE (or other
   supported method) without that header and preserve the empty payload value.
5. Validate the effective limit as a positive safe integer before reading. Reuse
   global -> controller -> action precedence. A later `next` action cannot
   retroactively change a parsed body's limit. Preserve `forms.enabled: false`
   for apps owning parsing.
6. Make 400/413/415 client rejections terminal and nonfatal: no controller,
   `requestEnd` continuation, application server-error hook, or process exit
   under either error policy, using the general 5xx-only exit fix above. Assign
   malformed JSON/UTF-8 an explicit 400 so a SyntaxError does not default to 500.
   Run completion once. Fix the current parse catch falling through into
   `requestEnd`.
7. On overflow, stop accumulation, send 413 while writable, and close after
   flushing the rejection instead of draining an unbounded remainder. Set
   `Connection: close`, disable connection reuse, and destroy the captured socket
   after response finish/end flush; also clean up on error/close and bound a
   stalled flush. Do not await upload completion or keep accumulating data.
   Test that the client receives 413 before closure and that no subsequent
   request reuses the socket. Handle aborted uploads without extra writes or
   retained listeners/buffers. Leave invalid HTTP framing to Node.

Keep the global 524288-byte default. Document the existing per-action override
with an HTTP example proving a larger batch-import body does not raise another
route's form limit. Record inclusive limits and charset/UTF-8 handling as 2.0
behavior changes, and nonfatal 4xx handling as restoration of the intended
application-error exit policy.

## Reverse-proxy deployment

Include a supported deployment example alongside the streaming API. The writer
continues to use Node's framing and transport; proxy configuration determines
buffering, compression, caching, timeout budgets, and propagation of disconnects.
The probe below establishes behavior for one Nginx version/configuration, not
for all gateways or production deployments.

Illustrative Nginx location for a dual JSON/SSE `/events` endpoint, inside the
application's existing HTTP(S) server block:

```nginx
location = /events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Forwarded "for=$remote_addr;host=$http_host;proto=$scheme;";

    proxy_buffering off;
    proxy_cache off;
    proxy_intercept_errors off;
    proxy_ignore_client_abort off;
    gzip off;

    proxy_read_timeout 60s;
    proxy_request_buffering on;
    client_max_body_size 2m; # Example ceiling; coordinate with endpoint limits.
}
```

- Preserve the deployment's external host/protocol information, as Citizen's
  existing Proxy Header documentation requires for cookies, redirects, and CORS.
  An HTTP/2 TLS frontend can proxy to Citizen over HTTP/1.1. Specify upstream
  HTTP/1.1 explicitly for consistent behavior across Nginx versions; do not
  introduce WebSocket upgrade headers or manually force chunked encoding.
- Response buffering and compression are separate controls. The baseline uses
  `proxy_buffering off` and `gzip off`; compression is not inherently incompatible
  with streaming, but enabling it requires an incremental-delivery check. The
  probe demonstrated incremental gzip with response buffering disabled and held
  events when gzip and buffering were both enabled. An application-supplied
  `X-Accel-Buffering` value can change Nginx buffering unless its processing is
  disabled by `proxy_ignore_headers`; neither control is a universal proxy API.
- `proxy_read_timeout` measures upstream inactivity, including waiting for setup
  to produce headers, rather than total response duration. The example's 60s is
  a deployment value, not a new Citizen default. Choose it with the setup budget
  and heartbeat interval; intermediate gateways can impose additional limits.
- Keep client-abort propagation enabled and error interception disabled for the
  baseline. A proxy can retain upstream work after a browser disconnect or replace
  Citizen's JSON diagnostics with its own error page. Proxy-originated failures,
  including upload 413 and setup-timeout 504, are outside Citizen's error schema;
  fetch consumers must inspect status and Content-Type before parsing errors.
- Disable proxy caching for the whole dual-format location, including JSON
  responses. The stream's `no-store` cannot prevent an earlier cached JSON
  response from being served before Citizen runs. An application-supplied
  `Vary: Accept` separated the variants in the probe; automatic framework Vary
  handling remains the separate work item. Preserve existing Vary fields when
  an application supplies it. Citizen's own cache bypass does not control an
  intermediary's cache.
- Request buffering is independent of response streaming and may remain enabled
  for ordinary JSON uploads. With it enabled, Nginx can receive the entire body
  before Citizen sees the request. Proxy body limits must permit the intended
  endpoint payload size; the example's 2m does not change Citizen's global limit
  or establish a recommended universal limit. Turning request buffering off is
  a separate deployment choice when early upstream handling is required.
  Citizen's overflow/connection-close guarantees concern its own connection:
  they cannot reclaim an upload already buffered by Nginx or require the
  browser's HTTP/2 connection to close.

References: [Nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html),
[response buffering](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/#configuring-buffers),
[gzip](https://nginx.org/en/docs/http/ngx_http_gzip_module.html), and
[body-size limits](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).

## Delivery and validation

Use small commits/PRs with tests alongside each runtime change:

| Step | Changes | Completion evidence |
| --- | --- | --- |
| 1. Shared error repairs | Header-aware, non-rejecting error handling, 5xx-only exit, the missing JSON error body, and JSON fallback for unresolved or unsupported error formats. | New `test/error-http.test.js` and focused handler checks cover 4xx survival, 5xx child-process exit, committed/ended responses, and preserved status/message/stack output with and without a layout. |
| 2. Shared content negotiation | Match effective endpoint types, expose the choice before hooks/actions, preserve forced types, defer unmatched 406 handling to response validation, and reject buffered output requiring an unavailable renderer. | `test/negotiation-http.test.js` covers matching, client-order compatibility, configuration precedence, defaults, overrides, renderer availability, and existing cache paths; document compatibility changes and parser limitations. |
| 3. Declared-request lifecycle | Declaration validation/cache bypass, private AbortController and completion state, managed directive handoff including the buffering hint, and scoped bodyless handling. | Strict boolean eligibility precedes hook setup; all four buffered continuation gates stop after disconnect. Headers/cookies precede commit, redirects precede source consumption, and cancellation completes once without a success log. |
| 4. Streaming core | Source normalization, writer, signal consumption, and raw byte counts. | New `test/stream-http.test.js` plus focused writer tests prove incremental delivery and controlled drain/close races. No global completion refactor is required. |
| 5. Built-in SSE | Branching on the negotiated type, descriptor/type validation, diagnostic JSON errors, serializer, heartbeat scheduling, retry fields, reconnect ID access. | New `test/sse.test.js` and `test/stream-http.test.js` provide repeatable protocol/integration coverage; record browser smoke separately. Steps 3–5 ship together on the shared negotiation path. |
| 6. Bodies | JSON decoding, byte accounting, terminal rejection, overflow connection closure, override documentation. | New `test/payload-http.test.js` proves UTF-8 correctness, bodyless/chunked acceptance, rejection, and limit isolation. Can land after step 1 independently of steps 2–5. |
| 7. Documentation | README, CHANGELOG, MIGRATION, hook scaffold comments where semantics change. | General-purpose examples, negotiation/default compatibility changes, corrected exit/JSON-error behavior, the managed lifecycle, session expiry, browser/fetch behavior, and the proxy recipe/limits below. No new stack-redaction policy or global hook-order migration. |

Follow the disposable scaffold/child-process pattern in
[cache-http.test.js](../../../test/cache-http.test.js), with automatic cleanup.
Share a small HTTP fixture helper only if needed; avoid rewriting the existing
cache harness as a prerequisite.

Required negotiation coverage:

- Exact media types, case/whitespace handling, quality ordering, specific ranges
  versus wildcards, explicit quality-zero exclusions, invalid ranges/weights,
  and no acceptable candidate. Test both tables above, ranking by quality,
  specificity, client order, then configured order. Exercise Axios's default
  Accept and `application/json, */*` against Citizen's default list, plus reversed
  explicit equal-weight lists. A JSON-first offered list alone would conceal
  the compatibility regression.
- Bare configured strings are returned unchanged despite differing client case;
  configured-type guards and case-insensitive renderer lookup agree on the
  result. Non-`q` parameters are ignored under the documented bare-type
  limitation, including browser navigation headers with `v=b3` before `q`.
  Parse weights regardless of parameter position. Accept `1.0`, `1.000`, and
  the compatibility forms `.5`/`.125`; reject nonnumeric, out-of-range, and
  overprecision weights by skipping their range, never defaulting them to 1.
- Global/controller/action offered-list precedence with replacement rather than
  union; the selected type is visible to hooks and the initial action. Include
  ordinary JSON-only actions, dual JSON/SSE actions, and configured NDJSON/binary
  types. Preserve existing hook execution order and configuration inheritance.
- Omitted Accept and `*/*` follow the effective configured preference, including
  default HTML and JSON-first/SSE-first overrides. Mixed headers can fall back to
  an available lower-weight type; explicit plain text is matched as plain text.
- No-match requests expose an unresolved type without a fabricated plain-text
  value. A hook/controller can still force a configured format before response
  validation; otherwise 406 is nonfatal and has a diagnostic body. Do not look
  up a cache entry under an unresolved type or recursively negotiate the error.
- Existing forced-format, explicit-header, and request/action-cache regressions
  still pass with the chosen type used at the existing lookup points. Later
  hooks/controllers/includes may retain their existing explicit override
  behavior; no automatic renegotiation overwrites them.
- Through the illustrative dual-format action, JSON selection returns a buffered
  snapshot and SSE selection returns events without application Accept parsing.
  A conflicting SSE descriptor is a contract 500 after a valid JSON selection;
  an explicit allowed SSE override works. A valid source with an unresolved client
  mismatch is disposed before 406; a declared source-free 204 bypasses final
  format rejection. Cover ordinary buffered successes and JSON errors separately.
- A buffered return requiring an unavailable SSE/NDJSON/CSV renderer produces a
  contract 500 with diagnostics under capture, and retains fatal 5xx behavior
  under exit. Verify that valid raw/SSE streams, manually completed responses,
  and supported bodyless responses are not rejected by that renderer check.

Required shared lifecycle/error coverage:

- Under `errors: 'exit'`, representative 400/403/404/405/406/413/415 errors keep
  the child process alive, skip the application error hook, and permit a later
  valid request. Test open, committed, and already-ended responses, plus
  `respond: false` and `err.result: 'exit'` on 4xx. Do not mutate a committed
  status or emit a second body. Body-specific cases can land with step 6.
- 500, 503, and errors with no status retain fatal exit under `exit`; capture
  remains nonfatal, including `err.result: 'capture'` overriding global exit.
  Cover before/after commit and ended responses, hook ordering, exit code 1,
  and once-only cleanup. Distinguish a separate 5xx error-handler failure from
  the original client error.
- Missing handler arguments and failures in the error hook, logging, rendering,
  and cleanup cannot create recursive error emissions, unhandled rejections,
  or leave an available response open. Include a throwing hook on a committed
  manual stream.
- Under capture, JSON errors return an actual body without requiring a layout;
  message and stack remain available with and without one, including production
  mode. Cover the shared JSON/JSONP renderer, existing namespacing, compression,
  and the generalized pre-commit JSON fallback. Logs and hooks retain the original
  error.
- Missing-controller 404, pre-action payload 413, and hook/application 500 errors
  receive a JSON body when the selected type is unresolved or has no buffered
  renderer. Exercise SSE, NDJSON, and CSV selections with no view/layout;
  preserve the original status, message, stack, and application error-hook
  classification. The success-format guard must not turn these errors into 406
  or recurse. Supported error formats and valid hook overrides still work;
  body suppression, committed/closed responses, reporting-only errors,
  cancellation, and fatal exit retain their existing body-handling rules.
- Buffered/cache/manual regressions preserve existing directive and end-hook
  ordering, including buffered completion relative to cache insertion. Do not
  change their expected counts to demand new manual or aborted-response hooks.

Required streaming coverage:

- Async generator/Readable/Web ReadableStream, string/byte chunks, empty output,
  invalid chunks, and rejection of sync-only sources.
  Prove the client receives a first frame while the producer is still blocked
  on a controlled gate, not just that the final body is correct. TCP chunk
  boundaries are not application-frame boundaries.
- Hook security/cache headers, controller overrides, forced type/charset,
  status, cookies, and sessions before first data; GET/POST SSE, NDJSON, binary,
  and HEAD/bodyless responses that never pull a source. Include first-visit
  session cookies and merging the full cookie context at managed handoff.
- Accumulated hook/controller redirects prevent managed source consumption,
  including direct routes, without changing which hooks/actions run beforehand.
  Exercise the current direct-request gate so reuse of `setRedirect()` cannot
  silently bypass the managed redirect.
- Backpressure stops pulls; close/error during drain or `next()` settles.
  Combine deterministic writer tests with a slow HTTP client rather than
  depending on precise delays/socket-buffer thresholds.
- Disconnect during setup or after data aborts upstream work and cleans up once.
  Include normal POST body completion, late setup resolution, rejecting cleanup,
  and an uncooperative producer. A disconnect-induced abort in a declared
  endpoint's buffered fallback is nonfatal; a real 5xx that aborts during cleanup
  retains its error classification. An AbortError name alone is insufficient.
- Disconnect during a declared endpoint's buffered fallback while controller,
  include, or encoding work awaits. After that work resumes, the four named
  `fireController()`/`next()`/`respond()` gates must stop further headers, writes,
  chaining, and normal completion. The cancellation end hook runs once; no
  second end hook or successful access log follows. Pre-commit failures still
  receive their intended diagnostic response when the transport is writable.
- Pre-handoff HTTP errors versus failures after header flush/first data; error
  hook failures, both capture/exit policies, and no unhandled rejections.
- Pre-seeded request/action cache entries are bypassed; no stream insertion,
  layout/include work, JSON wrapping, compression, conditional 304, or debug
  markup. Test invalid ownership/placement and ordinary buffered fallbacks,
  including explicit returned cache directives. Cover global/controller/action
  object/boolean/SSE option validation, precedence and opt-outs, dispatch after reloads, and declared
  include/next targets with warm action caches. Verify global streaming installs
  the signal before hooks, supports buffered fallbacks, and bypasses existing
  caches when an opt-out is removed. Informational merged config must not alter
  a later target's declaration, even when the preceding controller overrides
  the application default.
- Invalid streaming settings install no managed signal/listeners during early
  setup, then fails at dispatch with the contract 500 before cache lookup or
  action execution. Test a malformed controller declaration even when an action
  supplies a valid override, since both supplied settings require validation.
- Raw Content-Length accepts exact/zero byte counts, rejects invalid declarations,
  and catches short/long output without writing beyond the declared length.
  Include multibyte text and HEAD/bodyless suppression. `local` stays hook metadata;
  refresh redirects cannot accompany a managed stream.
- Exactly one end hook for managed success, empty stream, abort, error, and
  bodyless completion; normal finish followed by close does not cancel twice.
  Guard against duplicate completion from existing redirect/buffered/error paths
  on declared requests. No success access log for managed cancellations/failures.
- A fully received request can stream beyond a deliberately short requestTimeout
  on both Node 22.0.0 and Node 24; no timeout-default change is necessary.
- Session expiry during a stream retains the existing session-end behavior and
  does not silently refresh the session on data or heartbeat writes.

Required SSE coverage:

- Frame bytes and independently parsed events for empty/multiline data, all line
  endings, Unicode, string/JSON/custom serialization, named/default events,
  empty/opaque IDs, retry zero, and control-only records. Reject field injection,
  malformed records, invalid options, and serialization errors. Test raw mode
  separately so pre-framed upstream SSE is never double-encoded.
- Automatic UTF-8 Content-Type for selected SSE, conflicting headers, hook
  precedence, unsupported types/statuses, HEAD, 204, redirects, and buffered
  responses. Exercise actual `Accept: text/event-stream`, `*/*`, and SSE-preferring
  mixed headers through the
  example's branches, plus an omitted header and JSON-preferring requests.
  Preserve explicit buffered formats and deliberate forced types. JSON error
  fallback retains the message and stack without requiring views. A source-free
  204 on a declared SSE-only endpoint precedes format checks and skips next/include,
  layout, compression, and caching. No retry/comment writes on bodyless or
  non-SSE responses. Contract violations are 500s; unresolved negotiation is
  406. Exercise both error policies without conflating these cases.
- Heartbeat while a source is idle or its next item is pending, reset after data,
  configurable/disabled heartbeat, slow clients, and simultaneous timer/data
  readiness. Prove no overlapping pulls, lost events, interleaved frames,
  accumulated heartbeat queue, lingering timer, or post-close write.
- Verify application/controller/action SSE defaults and descriptor overrides on
  the wire, including `heartbeat: false`, `retry: 0`, and `retry: false`. Partial
  settings must inherit omitted fields without mutating configuration. Raw
  streams must receive neither synthetic heartbeats nor retry controls.
- Initial/per-event retry fields and reconnection with Last-Event-ID, including
  opaque/non-ASCII IDs, a leading BOM, absent/empty headers, malformed UTF-8
  rejection on declared endpoints, and ID reset. Malformed Last-Event-ID on an
  undeclared endpoint does not introduce a new 400. An application fixture
  controls replay from its own history; Citizen supplies no hidden storage or
  delivery guarantee.
- Repeatable Node suites use a small independent SSE parser and scripted HTTP
  reconnects; they must not reuse the production serializer as the oracle or
  assume a native EventSource exists on Node 22.0.0. Verify EOF has no synthetic
  completion record, ID/retry controls, and POST/fetch consumption. These tests
  prove wire behavior, not a browser's reconnection implementation.
- Separately record a release browser smoke check using available browser tools
  or Playwright MCP: native EventSource reconnects with its last ID, stops on
  a subsequent 204, and closes through an application completion-event handler.
  Include pre-commit non-200 failure versus failure after a committed 200.
  This is separate from CI coverage; clean up temporary artifacts.
- Producer/serializer failure and disconnect clean up heartbeat and source state
  while preserving exactly one response end/error report as applicable.

Required proxy coverage:

- Add a disposable Nginx fixture around the implemented managed API, using an
  explicitly supplied local binary and isolated configuration, temporary paths,
  and loopback ports. Propose a dedicated `npm run test:proxy` script when this
  suite lands; keep an Nginx installation out of ordinary runtime dependencies.
  Record a real proxy run for release validation. An unavailable binary or a
  sandbox-blocked listener is an explicit skip/block, not a proxy test pass.
- A gated source must deliver a decodable first event before it is released to
  finish, over both HTTP/1.1 and HTTP/2 TLS frontends. Cover the default buffering
  hint, mixed-case explicit overrides, `proxy_buffering off`, and an ignored
  hint. Verify Citizen adds no hint to ordinary buffered, pre-handoff error,
  redirect, or bodyless paths; preserve application-supplied headers there.
  Use buffering plus gzip as a negative control; do not assume buffering alone
  always delays a small event. Check bytes, not browser visibility of X-Accel
  headers or assumptions about TCP chunk boundaries.
- With shortened controlled timeouts, an idle SSE producer survives multiple
  read-timeout periods through heartbeats. Disabled heartbeats and pre-handoff
  setup have distinct timeout outcomes. Client close/RST_STREAM reaches the
  upstream, aborts the managed signal, and completes once; an ignore-client-abort
  control demonstrates the proxy boundary. Keep the separate deterministic
  writer tests for backpressure and cleanup races.
- Preserve Accept and Last-Event-ID, diagnostic JSON/status, cookies and forwarded
  protocol, HEAD, and bodyless 204. Exercise source failure after commit as a
  transport termination. Show error interception replacing a diagnostic and
  proxy-originated errors not conforming to Citizen's JSON schema. Browser
  EventSource reconnection remains the separate browser smoke check.
- Seed a cacheable JSON representation, then request SSE at the same URL. Show
  the wrong cached representation without variation, and correct delivery with
  proxy caching disabled or application-supplied Vary. Automatic Vary remains
  separate; this is a deployment regression case, not a new framework cache API.
- Exercise request buffering independently of response buffering, per-location
  proxy body limits, POST/fetch streaming, and Citizen's early 413 behavior with
  an unbuffered upload. Do not require a downstream HTTP/2 connection to close
  when Citizen closes its HTTP/1.1 upstream connection.

Release examples must cover notifications, finite job progress, a live dashboard,
and a generated export through raw streaming. Include streamed logs or pre-encoded
NDJSON to demonstrate the core beyond SSE. Validate these behaviors without
requiring Sinyu, a model provider, or application-specific dependencies. Generic
byte delivery alone does not complete this feature; the SSE suite must pass too.

Required body coverage:

- Accents, CJK, emoji, multi-turn JSON, and multibyte characters split across
  chunks; bare/charset JSON, malformed UTF-8/JSON, unsupported charset, empty body.
- Below/exact/over limits with Content-Length and chunked transfer. Multibyte
  cases use byte lengths. Explicitly cover bodyless DELETE without Content-Length,
  zero-length bodies, early/mid-upload rejection, aborted uploads, and receipt of
  413 followed by connection closure without waiting for the remaining upload.
- Global/controller/action overrides, concurrent requests/config isolation,
  `forms.enabled: false`, multipart binary round trips, and URL-encoded forms.
- Client rejection never runs controllers, double-completes, or exits under
  `errors: 'exit'`; a subsequent valid request succeeds.

Run `npm test` and `npx eslint` for changed JavaScript files on Node 22.0.0 and
Node 24. Report sandbox-blocked HTTP checks explicitly; skipped tests are not a
complete HTTP pass, and leaving the sandbox requires permission. Review evidence
includes code/history inspection, Node/SSE documentation, and a Node 24 probe of
the registered error handler with `process.exit` intercepted, confirming fatal
4xx handling today. A response-stub probe also reproduced empty JSON errors
without a layout and stack-bearing JSON/JSONP with one. This update changes only
documentation; the full test suite was not run. The matrices above are
implementation acceptance requirements, not claims of completed runtime work.

### Local proxy probe: 2026-10-28

Completed 24 transport cases using Nginx **1.30.6**, Node **24.13.1**, OpenSSL
**3.6.4**, and macOS arm64. Nginx was compiled in a temporary directory from the
official source release. A disposable Citizen scaffold used the working tree
and a manually owned response; the fixture supplied SSE frames, heartbeat
timers, JSON/SSE branching, diagnostic JSON, and close cleanup. The managed API
and shared negotiation/error repairs are not implemented or validated by this
probe. Frontends used loopback HTTP/1.1 and self-signed TLS with HTTP/2 negotiated
through ALPN; the Nginx-to-Citizen connection used HTTP/1.1.

The producer wrote an initial event and waited for an explicit IPC release
before ending. Buffering controls used a 500 ms observation window while this
gate stayed closed; gzip observations measured decoded event arrival. Timeout
controls used a 1s upstream read timeout, 100 ms heartbeats, and a 2.2s stream.
These are transport observations, not latency benchmarks or recommended
production timer values.

| Case group | Observed result |
| --- | --- |
| Direct Citizen and proxy buffering controls | Direct delivery and Nginx with gzip off delivered before gate release, including default response buffering. Buffering alone did not delay these small events in this configuration. |
| Gzip and buffering together | No decoded event arrived during the 500 ms hold; the first event arrived at completion, about 518 ms. Ignoring the buffering hint reproduced this result at about 520 ms. |
| Buffering hint / explicit buffering off | Both allowed incremental delivery. Gzip also delivered before completion when buffering was disabled. Nginx consumed the X-Accel header; its absence downstream did not indicate failure. |
| HTTP/2 frontend | TLS negotiated `h2`; the first event arrived before completion. Accept, ASCII Last-Event-ID `42`, and forwarded HTTPS reached Citizen; 204 remained bodyless. |
| Heartbeats and setup | 21 heartbeats kept a 2.2s response alive across a 1s timeout. Without heartbeats, the established stream aborted at about 1s. Setup that produced no headers yielded a proxy-generated HTML 504 at about 1s. |
| Disconnect propagation | HTTP/1.1 and HTTP/2 client cancellation reached Citizen's response close in about 22/17 ms. With `proxy_ignore_client_abort on`, pending setup remained open for the 500 ms observation window after client disconnect. |
| Error interception | A manually generated 422 JSON body retained its message/stack through the baseline; configured interception replaced it with an HTML error page. This did not test the unimplemented shared error-body repair. |
| Cache variation | Cached JSON was returned as a HIT to an SSE request at the same URL without Vary. Disabling proxy caching returned SSE; application-supplied `Vary: Accept` produced a variant MISS and returned SSE. |
| Upload handling | With response buffering off but request buffering on, Citizen's request-start hook waited for upload completion. A 128-byte proxy limit rejected a larger body with HTML 413 before Citizen ran. |

The exact deployment example above also passed `nginx -t` inside an isolated
server configuration. The initial sandbox attempts failed on local listening
and Docker access; the user authorized leaving the sandbox for these tests.
All servers, source/build artifacts, certificates, caches, and temporary fixtures
were removed after recording the results. No production configuration was used.

The managed lifecycle, Node 22, browser reconnect behavior, and non-ASCII IDs
through Nginx were subsequently validated below. Deployment-specific gateways
still require application acceptance testing; this initial manual-path probe
remains distinct from validation of the implemented feature.

### Citizen documentation updates at implementation

- **README:** Add a streaming section covering raw/SSE returns, negotiation,
  producer setup, cancellation, completion, and EventSource versus POST/fetch.
  Include the Nginx example and explain each control's scope. Link the existing
  Proxy Header sections under Cookies, redirects, and CORS to it while retaining
  their external-host/protocol guidance. Document the buffering hint as a
  default for actual managed streams, explicit overrides, and its proxy-specific
  limits. Describe gzip as an optional validated deployment choice, and explain
  why cache bypass must include a dual-format action's JSON branch.
- **README Forms / Error Handling:** Distinguish Citizen limits and diagnostic
  responses from proxy upload limits, request buffering, and generated/replaced
  errors. Show fetch checking status and Content-Type before error decoding.
  Retain message/stack diagnostics and the agreed 5xx-only exit policy. Explain
  that heartbeat protection begins at handoff and that finish/close observations
  concern the immediate peer, not confirmed browser consumption.
- **MIGRATION:** Add ordinary-request negotiation changes and the manual-to-managed
  streaming switch, including removal of application SSE framing/timers when
  adopting the adapter. Require reviewing proxy buffering/compression, caching,
  timeouts, abort propagation, error interception, and upload ceilings. Do not
  prescribe disabling request buffering merely to enable streaming responses.
- **CHANGELOG:** Record the managed buffering hint, SSE transport support, shared
  negotiation, agreed error/body repairs, and new proxy integration coverage when
  implemented. Keep the local probe distinct from tests of the new feature;
  do not advertise automatic Vary, production-proxy verification, or browser
  delivery acknowledgements as implemented behavior.
- **Hook scaffold comments and test documentation:** Keep scaffold comments brief;
  document managed handoff and completion details in the README. Document the
  proxy-test command, binary prerequisite, tested versions, and fixture cleanup.

## Implementation and validation: 2026-10-28

Implemented the reviewed controller/action declaration and raw/SSE contracts in
`lib/stream.js`, `lib/sse.js`, and `lib/server.js`. Content negotiation lives in
`serve()` and body reading/decoding in `processRequest()`, both in `lib/server.js`.
`request.signal` remains scoped to declared entry requests. The read-only,
non-enumerable `response.completion` is null until `finished`, `cancelled`, or
`failed`. Declared bodyless handling covers 204/205/304; SSE descriptors still
permit only 200/204. No global lifecycle, stack-redaction, or Vary policy was added.

The writer uses one pending pull and separate bounded wakeups for next-item and
drain waits. This avoids retaining new Promise.race callbacks on an indefinitely
pending source at every heartbeat, and prevents a source resolving during a
blocked heartbeat from bypassing drain. Source/abort objects stay out of copied
controller contexts. Header handoff preserves explicit action precedence across
case variants. JSON diagnostics also retain both errors if an error layout fails. Error-like
objects retain their status, policy, and diagnostic properties when normalized,
so a thrown 4xx object cannot become a fatal 500 merely because it is not an
Error instance.

Validation on macOS arm64:

| Check | Result |
| --- | --- |
| Node 24.13.1, full `node --test` | 255 tests: 253 passed, 2 optional integration skips, no failures. |
| Node 22.0.0, full `node --test` | 255 tests: 250 passed, 5 skips (the same optional integrations plus 3 existing unsupported-syntax cases), no failures. |
| Nginx 1.30.6, `npm run test:proxy` | All 7 reported tests passed, including the parent suite and 6 scenario groups. Real HTTP/1.1 and TLS HTTP/2 frontend connections used the managed API. |
| Chrome 156.0.8078.49 via connected Playwright | Repository browser contract passed directly and through the documented Nginx baseline, against a fresh server using the final implementation. Reconnect status sequence was 200 then 204, Unicode ID was preserved, retry was about 57 ms for a 50 ms directive, named completion closed EventSource, and POST/fetch plus JSON diagnostics passed. |
| Code quality | ESLint passed for changed runtime/test files; `git diff --check` passed. |

The optional `test:browser` runner was not invoked with a separately installed
Playwright package; its shared browser contract was executed through the connected
Playwright tool. The default suite's skips therefore do not stand in for browser
or proxy validation. See [test instructions](../../testing-streaming.md).

Error-handling follow-up: removed `lastResortError` and its separate response
renderer. The listener retains a small reporting/cleanup catch and the existing
nested-rendering short-circuit. JSON/JSONP serialization handles unserializable
raw error metadata locally, preserving diagnostic stacks and layout output.
Regression tests cover those formats, HEAD suppression, ordinary output failures,
and cleanup before/after commit without recursive hooks. The HTTP fixture enables
error categories explicitly so log assertions check actual output. The follow-up
Node 24.13.1 run passed 255 tests with 2 optional integration skips; ESLint and
whitespace checks passed. The table above records the original implementation
validation, including the Node 22 and external integration runs.

Application-default follow-up (2026-10-29): added `citizen.streaming` with
`enabled: false`, SSE heartbeat/retry defaults, validation, and action/controller
overrides, resolved independently for entry, include, and next targets. Tests
cover global SSE and buffered responses, opt-outs, cache bypass, declaration
isolation, inherited SSE defaults, and descriptor overrides on the wire.
The full Node 24.13.1 suite passed 265 tests with 2 optional integration skips;
ESLint and whitespace checks passed.

The managed proxy matrix verifies decoded events before EOF with baseline,
X-Accel hint, and gzip settings; an ignored-hint control holds events. It also
covers heartbeat inactivity protection, quiet-stream truncation, setup 504,
abort propagation (including an ignore-abort control), error interception,
request buffering, upload ceilings, cache-mixing controls, HTTP/2 cancellation,
forwarded HTTPS, UTF-8 Last-Event-ID, HEAD, 204, and POST SSE. A cached JSON
snapshot can still mask SSE when proxy caching is enabled without variation;
the documented whole-location cache bypass prevents it.

README, MIGRATION, CHANGELOG, scaffold response-hook comments, and test commands
now document the implemented contract and compatibility boundaries. All local
servers/builds/certificates and browser scratch output are removed after validation;
no production configuration is involved. The historical requirements below and
above remain the design record; broader deferred work is still separate.

## Separate work, not streaming prerequisites

- Automatic `Vary: Accept` is separate caching correctness work, tracked in
  [Consider #22](../todo.md). Intermediaries need to distinguish cacheable
  representations selected by Accept at the same URL; Citizen's existing
  omission predates streaming. Define header merging and response coverage
  separately, retaining existing Vary fields rather than replacing them. See
  [RFC 9110, Vary](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.5).
- Changing production error disclosure, removing stacks, or replacing existing
  errors with generic bodies requires a separate policy decision. Existing
  diagnostic output is retained in this feature.
- Moving all buffered/cache/manual completion hooks to `finish`, changing their
  timing relative to cache insertion, or adding end hooks for every manually
  owned response is a separate lifecycle proposal.
- Moving all hook redirects ahead of action execution, or pre-applying every
  hook's headers/cookies for manual writers, changes existing directive ordering.
  Managed handoff does not require those changes. The existing direct-request
  redirect plan retains its own scope and approval.
- A framework-wide 204/bodyless-path repair, unrelated static/cache HEAD fixes,
  eager validation across all route loading/reloading, and general early-upload
  connection closure can be considered independently. Known bugs remain bugs;
  they do not all have to land with streaming.

The proxy recipe and acceptance coverage above are part of streaming integration;
automatic Vary remains separate. No production work,
shutdown redesign, routing optimization, or config-copy optimization is included.

## Adoption example: Sinyu

Keep AC-0 using its one-file manual adapter on today's Citizen: explicit headers,
drain handling, disconnect cancellation, and safe error termination. AC-0 does
not wait on this release. Once Citizen is ready, use its structured SSE contract
for application-owned events and heartbeats, or raw streaming when intentionally
proxying an upstream wire format. Retain application-specific event names,
completion semantics, and authorization/replay policy.

Remove JSON ASCII escaping after the parser repair and update dependency locks
in both consumers. The reported desktop abort and proxy limits have not been
verified here. Staging lock refresh and proxy verification belong to the
separately authorized Sinyu rollout; none are Citizen release requirements.
