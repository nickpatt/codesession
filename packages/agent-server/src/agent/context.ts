import type { ProjectClient } from "../session/projectClient.js";
import { estimateTokens } from "../llm/provider.js";

/** One file selected into the agent's working context. */
export interface ContextFile {
  path: string;
  content: string;
  /** The file's version stamp when it was read (for stale detection). */
  version: string;
}

/** The retrieved context handed to the model, plus bookkeeping. */
export interface ProjectContext {
  files: ContextFile[];
  /** path -> version, so the patcher can detect concurrent human edits. */
  versions: Map<string, string>;
  /** Approx tokens used by the included file contents. */
  tokens: number;
}

/**
 * Selects the files most relevant to a task instead of dumping the whole
 * project into the model. Even for small projects this keeps prompts focused;
 * for larger ones it's what makes the agent affordable and fast (spec §7-8).
 *
 * Relevance is a simple, explainable score — no embeddings needed for the MVP:
 *   + filename/keyword overlap with the prompt
 *   + test files and their targets (fixing tests is the primary use case)
 *   + import relationships between candidate files
 * Files are added highest-score-first until the token budget is reached.
 */
export function retrieveContext(
  project: ProjectClient,
  prompt: string,
  budgetTokens: number,
): ProjectContext {
  const paths = project.files();
  const promptWords = tokenize(prompt);

  const scored = paths.map((path) => {
    const content = project.read(path) ?? "";
    return { path, content, score: scoreFile(path, content, promptWords) };
  });

  // Pull in import/relationship neighbors: if a highly-scored file imports
  // another candidate, bump that neighbor so related files travel together.
  boostImportNeighbors(scored);

  scored.sort((a, b) => b.score - a.score);

  const files: ContextFile[] = [];
  const versions = new Map<string, string>();
  let tokens = 0;

  for (const s of scored) {
    const cost = estimateTokens(s.content) + 8; // +overhead for the path header
    if (tokens + cost > budgetTokens && files.length > 0) break; // keep at least one
    files.push({
      path: s.path,
      content: s.content,
      version: project.fileVersion(s.path),
    });
    versions.set(s.path, project.fileVersion(s.path));
    tokens += cost;
  }

  return { files, versions, tokens };
}

/** Score a single file's relevance to the prompt. */
function scoreFile(path: string, content: string, promptWords: Set<string>): number {
  let score = 0;

  // Filename overlap with prompt words is a strong signal.
  const nameWords = tokenize(path);
  for (const w of nameWords) if (promptWords.has(w)) score += 5;

  // Keyword overlap in the file body (capped so a huge file can't dominate).
  const bodyWords = tokenize(content);
  let overlap = 0;
  for (const w of promptWords) if (bodyWords.has(w)) overlap += 1;
  score += Math.min(overlap, 10);

  // Tests and the files they target are central to "fix failing tests".
  if (/test/i.test(path)) score += 3;

  return score;
}

/** Bump candidates that are imported by other high-scoring candidates. */
function boostImportNeighbors(
  scored: { path: string; content: string; score: number }[],
): void {
  const byModule = new Map<string, number>(); // module name -> index
  scored.forEach((s, i) => {
    const mod = s.path.replace(/\.py$/, "").split("/").pop();
    if (mod) byModule.set(mod, i);
  });

  for (const s of scored) {
    // Match `import x` / `from x import ...` for candidate modules.
    const imports = [...s.content.matchAll(/(?:^|\n)\s*(?:from|import)\s+([\w.]+)/g)];
    for (const [, mod] of imports) {
      const name = mod.split(".").pop();
      const idx = name !== undefined ? byModule.get(name) : undefined;
      if (idx !== undefined) scored[idx].score += 2;
    }
  }
}

/** Lowercase word set, splitting on non-word characters. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1),
  );
}
