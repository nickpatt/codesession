import { useParams } from "react-router-dom";
import { useCollab } from "../collab/useCollab.js";
import { Editor } from "../collab/Editor.js";

/**
 * The collaborative editor page. Connects to the session's Yjs document and
 * renders a CodeMirror editor bound to it.
 *
 * (A display-name prompt and presence list are layered on next; for now we use
 * a placeholder name so the editor + sync can be verified end to end.)
 */
export function SessionPage() {
  const { id } = useParams();
  const collab = useCollab(id ?? "", "Anonymous");

  return (
    <div className="session">
      <div className="topbar">
        <span className="brand">CodeSession</span>
        <span className="spacer" />
        <span className="status">session {id}</span>
      </div>
      {collab ? <Editor collab={collab} /> : <div className="editor-wrap" />}
    </div>
  );
}
