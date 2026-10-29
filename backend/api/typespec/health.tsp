import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace Lumei;

/** Minimal health payload returned by the basic health check. */
model BasicHealthResponse {
  @example("ok") status: string;
}

/** Result of one dependency's health check. */
model HealthCheckEntry {
  @example("healthy") status: string;

  /** Whether a failure of this check makes the whole service unhealthy (503). */
  critical: boolean;

  response_time_ms: int64;
  timestamp: utcDateTime;

  /**
   * Check-specific diagnostics, present only on a passing check that has any.
   * The database reports `driver` and its connection-pool counters.
   */
  details?: Record<unknown>;
}

/**
 * Detailed health payload with one entry per dependency.
 * `status` is `unhealthy` (503) when a critical check fails, `degraded` (200) when
 * only non-critical checks fail, and `healthy` otherwise.
 */
model HealthResponse {
  @example("healthy") status: string;

  /** One entry per dependency, keyed by name: `database` (critical). */
  checks: Record<HealthCheckEntry>;
}

/** Service is running. */
model BasicHealthOk {
  @statusCode statusCode: 200;
  @body body: BasicHealthResponse;
}

/** Detailed health status of every dependency. */
model HealthOk {
  @statusCode statusCode: 200;
  @body body: HealthResponse;
}

/** A critical dependency (the database) is unavailable. */
model HealthUnavailable {
  @statusCode statusCode: 503;
  @body body: HealthResponse;
}

@tag("health")
interface Health {
  /**
   * Confirms the web server is up and serving requests. It does not check
   * dependencies; see /health/full for that.
   */
  @summary("Basic health check with HTTP server status")
  @operationId("getHealth")
  @get
  @route("/health")
  getHealth(): BasicHealthOk;

  /**
   * Confirms downstream dependencies (the database) are reachable.
   * Only a failing critical check answers 503; any other failing check answers
   * 200 with `status: degraded`.
   */
  @summary("Detailed health check with dependency status")
  @operationId("getHealthFull")
  @get
  @route("/health/full")
  getHealthFull(): HealthOk | HealthUnavailable;
}
