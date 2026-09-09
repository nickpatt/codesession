import { useEffect, useState } from "react";
import * as Y from "yjs";
import { getFiles } from "@codesession/shared";

/**
 * Reactively tracks the list of file paths in the shared project. Re-renders
 * whenever files are added or removed — including when the AI agent creates a
 * file — so the file tabs always reflect the live document.
 */
export function useProjectFiles(doc: Y.Doc | null): string[] {
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!doc) return;
    const files = getFiles(doc);
    const update = () => setPaths([...files.keys()].sort());
    update();
    files.observe(update);
    return () => files.unobserve(update);
  }, [doc]);

  return paths;
}
