import type { AgentAction } from "@codesession/shared";
import type { ProjectClient } from "../session/projectClient.js";

/** Outcome of trying to apply a patch action. */
export type PatchResult =
  | { ok: true; path: string }
  | { ok: false; reason: string; stale?: boolean };

/**
 * Applies a structured edit action to the shared document, guarding against
 * clobbering concurrent human edits.
 *
 * Before applying, we compare the file's current version to the version the
 * agent saw when it built its context. If a human changed that file in the
 * meantime, we refuse the patch and report it as stale so the orchestrator can
 * re-read context and regenerate — the agent never blindly overwrites newer
 * human changes (spec section 10).
 */
export class Patcher {
  constructor(private readonly project: ProjectClient) {}

  apply(
    action: AgentAction,
    contextVersions: Map<string, string>,
  ): PatchResult {
    switch (action.action) {
      case "create_file": {
        // Creating a brand-new file is safe; if it already exists and changed,
        // treat it as stale to avoid surprising a human.
        const existing = this.project.read(action.path);
        if (existing !== undefined) {
          const seen = contextVersions.get(action.path);
          if (seen !== undefined && seen !== this.project.fileVersion(action.path)) {
            return { ok: false, reason: `file ${action.path} changed`, stale: true };
          }
        }
        this.project.writeFile(action.path, action.content);
        return { ok: true, path: action.path };
      }

      case "edit_file": {
        const current = this.project.read(action.path);
        if (current === undefined) {
          return { ok: false, reason: `file ${action.path} does not exist` };
        }
        // Stale check: did the file change since we read context?
        const seen = contextVersions.get(action.path);
        if (seen !== undefined && seen !== this.project.fileVersion(action.path)) {
          return { ok: false, reason: `file ${action.path} changed`, stale: true };
        }

        // Apply changes from the bottom up so earlier line numbers stay valid
        // as later edits shift the file.
        const changes = [...action.changes].sort((a, b) => b.startLine - a.startLine);
        for (const ch of changes) {
          const applied = this.project.applyLineEdit(
            action.path,
            ch.startLine,
            ch.endLine,
            ch.replacement,
          );
          if (!applied) {
            return {
              ok: false,
              reason: `edit out of range in ${action.path} (${ch.startLine}-${ch.endLine})`,
            };
          }
        }
        return { ok: true, path: action.path };
      }

      default:
        return { ok: false, reason: `not a patch action: ${action.action}` };
    }
  }
}
