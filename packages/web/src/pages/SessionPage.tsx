import { useParams } from "react-router-dom";

/**
 * The collaborative editor page. Scaffold version: confirms routing works and
 * shows the session id. The CodeMirror + Yjs editor is wired up next.
 */
export function SessionPage() {
  const { id } = useParams();
  return (
    <div className="session">
      <div className="topbar">
        <span className="brand">CodeSession</span>
        <span className="status">session {id}</span>
      </div>
      <div className="editor-wrap" />
    </div>
  );
}
