import { useParams } from "react-router-dom";
import { useCollab } from "../collab/useCollab.js";
import { Editor } from "../collab/Editor.js";
import { JoinDialog } from "../components/JoinDialog.js";
import { ShareLink } from "../components/ShareLink.js";
import { PresenceList } from "../components/PresenceList.js";
import { ConnectionStatus } from "../components/ConnectionStatus.js";
import { usePresence } from "../collab/usePresence.js";
import { useDisplayName } from "../hooks/useDisplayName.js";

/**
 * The collaborative editor page.
 *
 * Flow: if we don't yet know the user's display name, show the join dialog.
 * Once we have a name, connect to the session's Yjs document and render the
 * editor bound to it, with the shareable link in the top bar.
 */
export function SessionPage() {
  const { id } = useParams();
  const [name, setName] = useDisplayName();

  // Don't connect until we have a name, so the user's cursor is labeled.
  const collab = useCollab(name ? (id ?? "") : "", name ?? "");
  const participants = usePresence(collab?.provider ?? null);

  if (!name) return <JoinDialog onJoin={setName} />;

  return (
    <div className="session">
      <div className="topbar">
        <span className="brand">CodeSession</span>
        <ShareLink />
        <span className="spacer" />
        {collab && <ConnectionStatus status={collab.status} />}
        <PresenceList participants={participants} />
      </div>
      {collab ? <Editor collab={collab} /> : <div className="editor-wrap" />}
    </div>
  );
}
