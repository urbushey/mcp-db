# ADR 0001: Remote MCP OAuth provider for MVP

Status: accepted (MVP)
Date: 2026-03-25
Issue: #11

## Decision

For the hosted remote MCP MVP, use **WorkOS AuthKit / WorkOS Connect** as the OAuth authorization server.

Do **not** use Clerk for this track.

Treat **Auth0** as a viable fallback, but not the default MVP choice.

## Why this decision exists

Claude remote MCP clients need more than generic "login". The MVP auth provider must fit the MCP authorization model closely enough that we are not hand-building large protocol gaps.

The relevant MCP requirements are:

- OAuth 2.1 authorization flow
- Authorization server metadata (`/.well-known/oauth-authorization-server`)
- Protected resource metadata on the MCP server side (`/.well-known/oauth-protected-resource`)
- Dynamic Client Registration as a strong interoperability expectation for MCP clients
- Bearer token auth on every MCP request
- Server-side token validation, including audience/resource checks
- Support for PKCE/public clients because Claude acts like a third-party client

## Criteria used

### Must-have

1. Works as an **authorization server**, not just app login UI
2. Supports or clearly exposes:
   - authorization server metadata
   - registration endpoint / dynamic client registration story
   - token endpoint
   - token verification/introspection or JWKS
3. Can issue tokens suitable for a third-party MCP client
4. Reasonable integration path for Bun + Fly.io
5. Low enough implementation risk for MVP

### Nice-to-have

- Social login, password reset, MFA, hosted UI
- Good docs for OAuth primitives
- Explicit compatibility with MCP-like clients

## Findings

### WorkOS: best MVP fit

Why it stands out:

- WorkOS exposes an OAuth authorization server metadata endpoint and explicitly documents `/.well-known/oauth-authorization-server`.
- WorkOS docs explicitly say **"Model Context Protocol (MCP) clients that support the latest version of the specification use this endpoint"**.
- WorkOS exposes a `registration_endpoint`, `token_endpoint`, `introspection_endpoint`, and related OAuth metadata.
- WorkOS docs show OAuth applications with `was_dynamically_registered`, which is a strong signal that the DCR path is real rather than theoretical.
- Token introspection is documented, which gives a straightforward fallback if we do not want to rely only on local JWT verification on day one.
- Hosted auth + user management keeps us out of the business of building sign-up, reset, MFA, etc. during MVP.

Why it fits this repo:

- The service is already Bun-based and moving toward HTTP transport. WorkOS keeps the app-side work focused on:
  - protected resource metadata
  - OAuth challenge/401 behavior
  - bearer token extraction
  - token validation
  - per-user directory scoping
- That is a better MVP split than also inventing auth-server behavior.

### Auth0: technically plausible, but higher-friction than WorkOS

What looks good:

- Auth0 supports Dynamic Client Registration at `/oidc/register` when enabled.
- It is mature, widely used, and can absolutely act as an OAuth/OIDC provider.

Why it is not the MVP default:

- The docs we reviewed confirm DCR, but WorkOS is much more explicit about the exact authorization-server metadata shape relevant to MCP clients.
- Enabling open dynamic registration in Auth0 is a security-sensitive tenant setting and deserves careful threat review before exposing it broadly.
- Auth0 appears workable, but more assembly is likely needed to make the MCP-specific story feel predictable.
- For a solo/small MVP, Auth0 tends to add product/admin complexity earlier.

Verdict: **fallback option**, especially if WorkOS pricing/terms become a blocker.

### Clerk: poor fit for this specific problem

What Clerk does well:

- App authentication and user management
- OAuth token issuance/verification for app integrations

Why it is the wrong shape here:

- Clerk documentation explicitly says **"OAuth User Management ... is not currently supported by Clerk"**.
- We did not find evidence of Clerk exposing the authorization-server metadata and DCR posture we want for remote MCP interoperability.
- Clerk looks better suited to authenticating users *into our app* than serving as the standards-oriented authorization server for third-party MCP clients.

Verdict: **do not use for remote MCP MVP auth**.

## Recommended MVP integration shape

### Responsibility split

**WorkOS owns:**
- user sign-in / sign-up
- MFA / password reset / social login
- OAuth authorization server endpoints
- client registration
- token issuance

**instant-db service owns:**
- MCP HTTP transport (`/mcp`)
- protected resource metadata (`/.well-known/oauth-protected-resource`)
- `401` + `WWW-Authenticate` challenge behavior
- bearer token validation
- mapping token subject/user to `data/{user_id}/`
- request-level authorization and rate limiting

## Validation strategy

### MVP-safe approach

Use one of these, in order of preference:

1. **Local JWT verification via JWKS**, if WorkOS-issued access tokens are JWTs with the claims we need (`iss`, `sub`, `aud` or equivalent resource indicator)
2. **Token introspection fallback** if token format/claims are opaque or not stable enough for local verification

For MVP, introspection is acceptable even if it is not the final scale architecture.

## Bun/Fly notes

WorkOS is friendly to a Bun/Fly deployment because the app integration is just HTTPS calls plus standard bearer-token handling. No provider-specific runtime dependency appears to require Node-only middleware.

That means Fly-specific work stays normal:

- store WorkOS secrets as Fly secrets
- serve MCP + metadata endpoints over HTTPS
- optionally cache JWKS in memory
- keep token validation logic in plain TypeScript

## What we still need to implement in this repo

1. `/.well-known/oauth-protected-resource`
2. `401 Unauthorized` responses with `WWW-Authenticate` pointing clients to resource metadata
3. auth middleware for HTTP transport
4. token verifier abstraction:
   - `verifyAccessToken()`
   - WorkOS implementation via JWKS and/or introspection
5. user-scoped `DatabaseRegistry` rooted at `data/{user_id}`
6. config for issuer/audience/resource URL
7. tests for:
   - unauthenticated MCP request
   - bad token
   - valid token with user scoping
   - audience/resource mismatch

## Deferred / open risks

- We still need to confirm the exact access-token claims WorkOS returns for MCP-style public clients and whether they are sufficient for strict local audience/resource validation.
- Dynamic Client Registration should be tested end-to-end with Claude against a dev environment before we call the integration done.
- If WorkOS pricing or DCR constraints are unexpectedly unfavorable, Auth0 is the first fallback to revisit.

## Final recommendation

For **remote MCP MVP**, choose **WorkOS**.

It is the best fit because it most closely matches the MCP authorization model out of the box, including explicit authorization-server metadata and a documented MCP-oriented path, while keeping the service-side implementation small enough for a fast Bun/Fly MVP.
