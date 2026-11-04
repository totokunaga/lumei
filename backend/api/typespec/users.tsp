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

@tag("users")
interface Users {
  /** Returns the signed-in user. The app calls it on start to check the stored session (BR-ACC-03). */
  @summary("Get the signed-in user")
  @operationId("getMe")
  @useAuth(BearerAuth)
  @get
  @route("/me")
  getMe(): UserOk | Unauthorized;
}
