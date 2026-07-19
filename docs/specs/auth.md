# Authentication and access

The Assistant harness is a metered, auth-gated service. This spec fixes how a
client establishes an authenticated session, how the service decides what that
session may do, and why those answers hold uniformly across every environment a
client runs in. It is the identity and access contract that the harness service
(see `docs/specs/assistant.md`, "The open/closed line") is built on.

The editor and the bridge are open source. This spec assumes a modified,
hostile client and never relies on client good behavior for any security
property.

## One trust root

The authenticated session is the only authority. Identity, the set of targets a
principal may use, and the metering tier all derive from the credential the auth
server issues and the service validates. Nothing the client asserts about itself
is authority:

- The client's self-declared target and tag in the tool-manifest handshake are
  a request, checked against the session, never a source of truth.
- The client's environment -- domain, localhost, or a webview -- is not a
  security input. It may be recorded for telemetry; it never gates access.

This is the same rule the bridge applies to tool results: a value that crosses
from the client into the service is input to be validated, never protocol
authority.

## Authenticate the credential, not the environment

A client may run on a hosted domain, on localhost during development, or inside
a vscode extension webview. The service treats all three identically because it
authenticates the credential, not the place the code runs.

The deployment requires HTTPS in every environment, including local development
behind a reverse proxy. Secure-context browser APIs and `Secure` cookie
semantics are then uniform, and the backend carries no environment special
cases. Where a credential is obtained differs per environment; what the service
validates is one thing.

## Target and tag authority

A session's target is a request bounded by entitlement. The client asks for a
target in its handshake; the service admits it only if the authenticated
principal is entitled to it, and rejects any request outside the entitled set.
The authority is the entitlement carried by the session, not the client's claim.
Requesting an entitled target the user could have reached another way is not a
security event; requesting an unentitled one is refused.

The content version (the prompt tag) for a target is service-controlled and
pinned by the service. It is never chosen by the client. A client may declare a
protocol or client version for compatibility negotiation; a mismatch resolves to
refresh or reject, and declaring a false one gains nothing.

The safety kernel is target-invariant. Because the ground rules do not vary by
target, a session that somehow selected the wrong entitled target cannot thereby
obtain a lower safety floor. Target selection and the safety contract are
independently guaranteed.

## The durable credential never enters the client script context

The client is a public client: it holds no secret, because its source is public.
The durable credential is kept out of the page's script context in every
environment.

- On the web, a server web tier (a backend-for-frontend) completes the
  authorization-code exchange and holds the refresh credential. The browser
  receives only an `httpOnly`, `Secure`, `SameSite` session cookie.
- In the vscode extension, the extension host performs the authorization flow
  and holds tokens in the editor's secret storage. The webview never holds them.

The script context only ever holds ephemeral, short-lived material. The
authorization-code flow uses PKCE, so no client secret is required and an
intercepted code cannot be redeemed by another party.

## The WebSocket ticket

A browser cannot set authorization headers on a WebSocket handshake, and a
credential in a URL is not acceptable. Session establishment therefore separates
authentication from connection:

1. The client makes an authenticated request over HTTP -- carrying the session
   cookie on the web, or an extension-held token in the webview.
2. The service issues a short-lived, single-use connection ticket bound to the
   principal, entitlements, and tier.
3. The client opens the WebSocket with that ticket, and the service binds the
   live session.

Ticket acquisition differs by environment; ticket presentation on the socket is
uniform. This is the layer at which all environments converge.

## Only registered clients can complete a login

Access is scoped to blessed client origins by the redirect allowlist, enforced
by the auth server. Authorization codes are delivered only to exact-match,
pre-registered redirect URIs. A third-party clone can render a login button, but
the code returns to a registered redirect on a controlled origin, never to the
clone -- so the clone cannot complete a login or obtain a session. The
backend-for-frontend reinforces this: a session materializes only as a cookie on
a controlled origin, so it cannot come to exist on a clone.

Each real client is a distinct registered client with its own tightly-scoped
redirect URIs:

- Production web registers its exact production origins only.
- Development registers its proxy origin under a separate client, so
  development redirect URIs never widen the production allowlist.
- The vscode extension registers its own redirect (a custom URI-handler scheme
  or the editor's redirect broker); the extension host receives the code, not
  the webview.

Origin and referer headers, a client secret, and endpoint obscurity are not the
boundary and are not relied upon. The registered redirect allowlist is.

## Tokens are audience-scoped and short-lived

Credentials are scoped to the harness service as their audience, so a credential
cannot be replayed against another service. They are short-lived, which bounds
how stale an entitlement claim can be. Longer sessions are maintained by refresh
held in the backend-for-frontend or the extension's secret storage, never in the
client script context. Revocation drops the service-side session for an
immediate disconnect and refuses the next refresh; the live session the service
already holds is the immediate-kill point.

## What rides where, by rate of change

Facts are placed by how fast they change:

- In the session credential: identity, the entitled target set, and the tier.
  These change slowly, and the short credential lifetime bounds their staleness.
- In live service state: the wallet, metered and decremented per turn, and the
  session object itself, which is the revocation point.
- Never in the client: refresh credentials and any secret.

The wallet is not a credential claim because it drains within a session; it is
authoritative only as live service state.

## Identity model

The service supports two identity channels, and a principal may arrive through
either:

- A home channel, where an adult holds the account and children are profiles
  under it. Children are not account holders.
- An institutional channel, where the institution holds the account and learners
  authenticate through the institution's identity and rostering systems.

A learner may have no email of their own and authenticate entirely through a
parent or institution. The identity layer is a consumer identity provider that
serves as the hub: it owns home accounts and consumer sign-in, and it federates
the institutional identity sources. Entitlements attach to the principal at the
hub regardless of which channel the login came through, so target authority has
a single home independent of login source. The concrete identity provider is a
deployment choice; the hub-plus-federated-sources shape is the contract.

## Data minimization

The service stores the least identifying data that function requires: a stable
opaque subject identifier from the identity provider and a self-chosen display
name. Personal data not needed for function is neither requested nor stored.
Minimizing held personal data is a standing constraint, not an optimization: it
bounds the data-subject obligations the service can incur.

## The phishing residual

Redirect scoping prevents a clone from completing a login and riding the
service. It does not prevent a clone that presents a counterfeit credential form
and harvests what a user types, because that user never reached the auth server.
The service closes that residual by preferring authentication methods that leave
little or no password surface:

- Federated sign-in, where the user authenticates on the identity provider's own
  origin and there is often no service-specific password to harvest.
- Origin-bound passkeys, which do not present on a counterfeit origin.

## Consent and audience constraints

The audience is children, and these constraints are invariants any deployment
must satisfy, independent of any rollout order:

- Verifiable parental consent is obtained before an under-age child uses the
  service. A parental payment transaction through a notifying payment system is
  an accepted method, so consent can be satisfied by the subscription flow.
- Held personal data is minimized as above.
- A data-processing agreement governs the identity provider and any processor
  that handles principal data.

These are constraints on any deployment; the order in which identity channels
and geographies are brought online is a rollout concern outside this spec.
