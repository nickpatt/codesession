import type { AgentAction, EditChange } from "@codesession/shared";

/**
 * Parsing and validation of the model's structured actions.
 *
 * The model is instructed to reply with a single JSON object describing one
 * action. Requiring structured actions (rather than letting the model touch
 * files directly) is what makes the agent safe to apply, easy to audit, and
 * possible to show step-by-step in the UI.
 */

/** Raised when the model's output can't be parsed into a valid action. */
export class ActionParseError extends Error {}

/**
 * Extract a JSON action from a model response. Accepts either a bare JSON
 * object or one wrapped in a ```json fenced block (the format we ask for).
 */
export function parseAction(text: string): AgentAction {
  const json = extractJson(text);
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new ActionParseError("model output was not valid JSON");
  }
  return validateAction(obj);
}

/** Pull the first JSON object out of the text (fenced block preferred). */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Fall back to the first {...} span.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  throw new ActionParseError("no JSON object found in model output");
}

/** Validate the shape of a parsed action, throwing on anything malformed. */
export function validateAction(obj: unknown): AgentAction {
  if (typeof obj !== "object" || obj === null || !("action" in obj)) {
    throw new ActionParseError("action object missing 'action' field");
  }
  const a = obj as Record<string, unknown>;

  switch (a.action) {
    case "read_file":
      requireString(a, "path");
      return { action: "read_file", path: a.path as string };

    case "create_file":
      requireString(a, "path");
      requireString(a, "content");
      return {
        action: "create_file",
        path: a.path as string,
        content: a.content as string,
      };

    case "edit_file": {
      requireString(a, "path");
      if (!Array.isArray(a.changes) || a.changes.length === 0) {
        throw new ActionParseError("edit_file requires a non-empty 'changes' array");
      }
      const changes = a.changes.map(validateChange);
      return { action: "edit_file", path: a.path as string, changes };
    }

    case "run_command": {
      const command =
        Array.isArray(a.command) && a.command.every((c) => typeof c === "string")
          ? (a.command as string[])
          : undefined;
      return { action: "run_command", command };
    }

    case "finish":
      requireString(a, "summary");
      return { action: "finish", summary: a.summary as string };

    default:
      throw new ActionParseError(`unknown action '${String(a.action)}'`);
  }
}

/** Validate a single edit change. */
function validateChange(raw: unknown): EditChange {
  if (typeof raw !== "object" || raw === null) {
    throw new ActionParseError("change must be an object");
  }
  const c = raw as Record<string, unknown>;
  if (
    typeof c.startLine !== "number" ||
    typeof c.endLine !== "number" ||
    typeof c.replacement !== "string"
  ) {
    throw new ActionParseError(
      "change requires numeric startLine/endLine and string replacement",
    );
  }
  if (c.startLine < 1 || c.endLine < c.startLine) {
    throw new ActionParseError("change has an invalid line range");
  }
  return {
    startLine: c.startLine,
    endLine: c.endLine,
    replacement: c.replacement,
  };
}

function requireString(a: Record<string, unknown>, key: string): void {
  if (typeof a[key] !== "string") {
    throw new ActionParseError(`action field '${key}' must be a string`);
  }
}
