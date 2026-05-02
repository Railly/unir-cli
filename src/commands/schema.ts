// `unir schema <command>` — JSON Schema introspection for agents.
// Stubs for now; will be filled per-command as implementations land.

import type { Command } from "commander";
import { emit, reportError } from "../cli/agent/json-mode";
import { unirError } from "../lib/errors";

const SCHEMAS: Record<string, unknown> = {
  "cursos list": {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      ok: { const: true },
      data: {
        type: "object",
        properties: {
          courses: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "fullname", "slug", "start", "end", "viewurl"],
              properties: {
                id: { type: "integer" },
                fullname: { type: "string" },
                slug: { type: "string" },
                start: { type: "string", format: "date" },
                end: { type: "string", format: "date" },
                viewurl: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
    },
  },
  // More schemas come as commands are implemented.
};

export function registerSchema(program: Command): void {
  program
    .command("schema [command...]")
    .description("Print JSON Schema for a command's --json output")
    .action((parts: string[], opts: { json?: boolean }) => {
      if (!parts || parts.length === 0) {
        emit({ available: Object.keys(SCHEMAS) }, opts);
        return;
      }
      const key = parts.join(" ");
      const schema = SCHEMAS[key];
      if (!schema) {
        reportError(unirError("validation-error"), opts);
        process.exitCode = 1;
        return;
      }
      emit(schema, opts);
    });
}
