import "@typespec/http";
import "@typespec/openapi";
import "./errors.tsp";

using Http;
using OpenAPI;

namespace Lumei;

/** A Lumei account. */
model User {
  @example("0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d10") id: string;

  /** The account's email address, in lower case (BR-ACC-07). */
  @example("user@example.com") email: string;
}

/** The signed-in user. */
model UserOk {
  @statusCode statusCode: 200;
  @body body: User;
}

/** The account and all of its data are deleted. */
model AccountDeleted {
  @statusCode statusCode: 204;
}

@tag("users")
interface Users {
  /** Returns the signed-in user. The app calls it on start to check the stored session (BR-ACC-03). */
  @summary("Get the signed-in user")
  @operationId("getMe")
  @useAuth(BearerAuth)
  @get
  @route("/me")
  getMe(): UserOk | Unauthorized;

  /**
   * Deletes the signed-in user's account (BR-ACC-05). It first revokes the
   * app's access to every Apple and Google sign-in linked to the account,
   * then permanently deletes the account and all of its data: every
   * session, sign-in, and synced record, including expense locations. Every
   * device is signed out: refreshing its tokens fails, and so does pushing
   * changes, even with an access token issued before.
   *
   * Errors: 503 `revocation_unavailable` when Apple or Google can't revoke
   * a sign-in right now; nothing is deleted then, so try again later.
   */
  @summary("Delete the signed-in user's account")
  @operationId("deleteMe")
  @useAuth(BearerAuth)
  @delete
  @route("/me")
  deleteMe(): AccountDeleted | Unauthorized | ServiceUnavailable;
}
