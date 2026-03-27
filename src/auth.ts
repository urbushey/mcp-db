import { createHash } from "node:crypto";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "./config.ts";

export type AuthenticatedUser = {
  subject: string;
  storageKey: string;
  token: string;
  claims: JWTPayload;
};

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function sanitizeSubjectForStorage(subject: string): string {
  return createHash("sha256").update(subject).digest("hex");
}

export function getUserDataDir(config: Config, subject: string): string {
  return join(config.DATA_DIR, "users", sanitizeSubjectForStorage(subject));
}

function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new UnauthorizedError("Invalid authorization header");
  }

  return match[1].trim();
}

export class JwtAccessTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: Config) {
    const jwksUrl = config.OAUTH_JWKS_URL ?? new URL("/.well-known/jwks.json", config.OAUTH_ISSUER).toString();
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verifyAuthorizationHeader(authorizationHeader: string | undefined): Promise<AuthenticatedUser> {
    const token = extractBearerToken(authorizationHeader);

    try {
      const verifyOptions: Parameters<typeof jwtVerify>[2] = {
        issuer: this.config.OAUTH_ISSUER,
        algorithms: ["RS256", "ES256", "PS256"],
      };
      // Only enforce audience if explicitly configured; some providers (e.g. WorkOS/AuthKit)
      // set aud to the DCR client_id rather than the resource URL.
      if (this.config.OAUTH_AUDIENCE) {
        verifyOptions.audience = this.config.OAUTH_AUDIENCE;
      }
      const { payload } = await jwtVerify(token, this.jwks, verifyOptions);

      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new UnauthorizedError("Token is missing subject");
      }

      return {
        subject: payload.sub,
        storageKey: sanitizeSubjectForStorage(payload.sub),
        token,
        claims: payload,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      throw new UnauthorizedError(error instanceof Error ? error.message : "Invalid bearer token");
    }
  }
}
