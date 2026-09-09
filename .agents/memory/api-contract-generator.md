---
name: API contract generator compatibility
description: OpenAPI-to-Zod generation is pinned to a Zod 3 runtime in this workspace.
---

The generated server validators currently target the installed Zod 3 API. Keep email formats as plain strings and integer fields as numeric schemas in OpenAPI unless the workspace generator/runtime is upgraded together.

**Why:** The installed generator emitted Zod 4-only helpers for OpenAPI `format: email` and `type: integer`, which made the generated library fail its typecheck even though code generation itself succeeded.

**How to apply:** When extending the shared contract, run codegen immediately and keep the spec compatible with the generated runtime before building routes or frontend hooks.