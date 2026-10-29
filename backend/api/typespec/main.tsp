import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

// Pull in the per-feature route files. Every .tsp file must be reachable from
// this entrypoint's import chain, otherwise the compiler ignores it. Add new
// features here as they are created.
import "./health.tsp";

using Http;
using OpenAPI;

/**
 * API server for Lumei.
 */
@service(#{ title: "Lumei API" })
@info(#{ version: "1.0.0" })
@server("{baseUrl}", "Lumei API server", {
  baseUrl?: string = "http://localhost:8080",
})
namespace Lumei;
