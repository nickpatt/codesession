import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { yCollab } from "y-codemirror.next";
import { remoteCursorsTheme } from "./remoteCursors.js";

/**
 * CodeMirror 6 editor bound to one file (a Y.Text) of the shared project.
 *
 * The `yCollab` extension does three jobs at once:
 *   1. Two-way binds the editor buffer to the shared Y.Text (so edits sync).
 *   2. Renders remote users' cursors and selections from awareness.
 *   3. Wires undo/redo to Yjs's UndoManager so history is collaboration-aware.
 *
 * Because Yjs is a CRDT, concurrent edits — even on the same line, even from the
 * AI agent — merge deterministically; every client ends up with identical text.
 * The editor is re-created when the selected file changes.
 */
export function Editor({
  file,
  provider,
}: {
  file: Y.Text;
  provider: WebsocketProvider;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: file.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        python(),
        oneDark,
        // The collaboration extension. Awareness carries our user field
        // ({ name, color }) which it uses to color and label remote carets.
        yCollab(file, provider.awareness),
        remoteCursorsTheme,
        EditorView.theme({ "&": { fontSize: "14px" } }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    return () => view.destroy();
  }, [file, provider]);

  return <div className="editor-wrap" ref={hostRef} />;
}
