import "@typespec/http";

using Http;

namespace Lumei;

/** An error the client can act on. */
model ErrorResponse {
  /**
   * A stable, machine-readable code, e.g. `invalid_request`,
   * `unsupported_provider`, `invalid_id_token`, `email_not_verified`, or
   * `unauthenticated`.
   */
  @example("invalid_id_token") code: string;

  /** A description for developers. Don't show it to users: it isn't translated. */
  message: string;
}

/** The request is malformed or names something unsupported. */
model BadRequest {
  @statusCode statusCode: 400;
  @body body: ErrorResponse;
}

/** The session token or ID token is missing, invalid, or expired. Sign in again. */
model Unauthorized {
  @statusCode statusCode: 401;
  @body body: ErrorResponse;
}

/** The request is understood but refused. */
model Forbidden {
  @statusCode statusCode: 403;
  @body body: ErrorResponse;
}
