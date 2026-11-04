import "@typespec/http";
import "@typespec/openapi";
import "./errors.tsp";
import "./users.tsp";

using Http;
using OpenAPI;

namespace Lumei;

/** The service a user signs in with (BR-ACC-01). `dev` works only where the server enables it. */
enum SignInProvider {
  apple,
  google,
  dev,
}

model SignInRequest {
  @example(SignInProvider.google) provider: SignInProvider;

  /**
   * The ID token Sign in with Apple or Google returned to the app. For `dev`,
   * the email address to sign in as.
   */
  id_token: string;
}

model SessionResponse {
  /**
   * A JWT that authenticates requests: send it as
   * `Authorization: Bearer <access_token>`. It is valid for 15 minutes.
   */
  access_token: string;

  /** When the access token expires. Get new tokens from `POST /auth/refresh` before then. */
  access_token_expires_at: utcDateTime;

  /**
   * Gets new tokens from `POST /auth/refresh`. Each refresh replaces it, so
   * store the new one. The session ends 90 days after the last refresh
   * (BR-ACC-03). Keep it in the device's secure storage.
   */
  refresh_token: string;

  user: User;
}

model RefreshSessionRequest {
  /** The refresh token from the last sign-in or refresh. */
  refresh_token: string;
}

/** New tokens. The refresh token in the request no longer works. */
model SessionRefreshed {
  @statusCode statusCode: 200;
  @body body: SessionResponse;
}

/** Signed in. */
model SignedIn {
  @statusCode statusCode: 201;
  @body body: SessionResponse;
}

/** Signed out. */
model SignedOut {
  @statusCode statusCode: 204;
}

@tag("auth")
interface Auth {
  /**
   * Signs in with an ID token from Apple or Google, and starts a session.
   * The first sign-in creates the account. A sign-in whose verified email
   * matches an existing account opens that account (BR-ACC-07); any other
   * email gets a separate account (BR-ACC-08).
   *
   * Errors: 400 `invalid_request` or `unsupported_provider`; 401
   * `invalid_id_token`; 403 `email_not_verified` when the provider doesn't
   * report the email as verified.
   */
  @summary("Sign in")
  @operationId("signIn")
  @post
  @route("/auth/sign-in")
  signIn(@body body: SignInRequest): SignedIn | BadRequest | Unauthorized | Forbidden;

  /**
   * Exchanges a refresh token for a new access token and refresh token, and
   * extends the session (BR-ACC-03). A refresh token just replaced still
   * works for a minute, so a lost response doesn't sign the user out.
   * Reusing it later ends the session, because only a copy would be used
   * that late.
   *
   * Errors: 400 `invalid_request`; 401 `unauthenticated` when the refresh
   * token is unknown, expired, or reused. Sign in again then.
   */
  @summary("Refresh the tokens")
  @operationId("refreshSession")
  @post
  @route("/auth/refresh")
  refreshSession(@body body: RefreshSessionRequest): SessionRefreshed | BadRequest | Unauthorized;

  /**
   * Signs out this device by ending its session (BR-ACC-04), so its refresh
   * token stops working. Its access token is checked without the database,
   * so it works until it expires, at most 15 minutes; the app discards it.
   * Other devices stay signed in.
   */
  @summary("Sign out")
  @operationId("signOut")
  @useAuth(BearerAuth)
  @post
  @route("/auth/sign-out")
  signOut(): SignedOut | Unauthorized;
}
