import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { yCollab } from "y-codemirror.next";
import type { Collab } from "./useCollab.js";

/**
 * CodeMirror 6 editor bound to a shared Yjs document.
 *
 * The `yCollab` extension does three jobs at once:
 *   1. Two-way binds the editor buffer to the shared Y.Text (so edits sync).
 *   2. Renders remote users' cursors and selections from awareness.
 *   3. Wires undo/redo to Yjs's UndoManager so history is collaboration-aware.
 *
 * Because Yjs is a CRDT, concurrent edits — even on the same line — merge
 * deterministically; every client ends up with identical text.
 */
export function Editor({ collab }: { collab: Collab }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const { text, provider } = collab;

    const state = EditorState.create({
      doc: text.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        python(),
        oneDark,
        // The collaboration extension. Awareness carries our user field
        // ({ name, color }) which it uses to color and label remote carets.
        yCollab(text, provider.awareness),
        EditorView.theme({ "&": { fontSize: "14px" } }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    return () => view.destroy();
  }, [collab]);

  return <div className="editor-wrap" ref={hostRef} />;
}
