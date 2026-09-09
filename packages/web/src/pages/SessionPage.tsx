import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getOrCreateFile, DEFAULT_FILE } from "@codesession/shared";
import { useCollab } from "../collab/useCollab.js";
import { useProjectFiles } from "../collab/useProjectFiles.js";
import { Editor } from "../collab/Editor.js";
import { JoinDialog } from "../components/JoinDialog.js";
import { ShareLink } from "../components/ShareLink.js";
import { PresenceList } from "../components/PresenceList.js";
import { ConnectionStatus } from "../components/ConnectionStatus.js";
import { OutputPanel } from "../components/OutputPanel.js";
import { FileTabs } from "../components/FileTabs.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { usePresence } from "../collab/usePresence.js";
import { useExecution } from "../exec/useExecution.js";
import { useAgent } from "../agent/useAgent.js";
import { useDisplayName } from "../hooks/useDisplayName.js";

/**
 * The collaborative editor page: a multi-file project editor with live
 * collaboration, a Run button (runs the project's tests in the sandbox), a
 * shared output panel, and the AI Agent panel.
 */
export function SessionPage() {
  const { id } = useParams();
  const [name, setName] = useDisplayName();

  const collab = useCollab(name ? (id ?? "") : "", name ?? "");
  const participants = usePresence(collab?.provider ?? null);
  const exec = useExecution(name ? (id ?? "") : null);
  const agent = useAgent(name ? (id ?? "") : null);
  const files = useProjectFiles(collab?.doc ?? null);

  // Which file the editor is showing. Default to the conventional entry file.
  const [activePath, setActivePath] = useState<string | null>(null);
  useEffect(() => {
    if (activePath && files.includes(activePath)) return;
    setActivePath(files[0] ?? null);
  }, [files, activePath]);

  if (!name) return <JoinDialog onJoin={setName} />;

  const connected = collab?.status === "connected" && exec.ready;
  const activeFile =
    collab && activePath
      ? getOrCreateFile(collab.doc, activePath)
      : collab
        ? getOrCreateFile(collab.doc, DEFAULT_FILE)
        : null;

  return (
    <div className="session">
      <div className="topbar">
        <span className="brand">CodeSession</span>
        <ShareLink />
        <span className="spacer" />
        {exec.running ? (
          <button className="stop" onClick={exec.stop}>
            ■ Stop
          </button>
        ) : (
          <button className="run" onClick={exec.run} disabled={!connected}>
            ▶ Run
          </button>
        )}
        {collab && <ConnectionStatus status={collab.status} />}
        <PresenceList participants={participants} />
      </div>

      <div className="main">
        <div className="workspace">
          <FileTabs files={files} active={activePath} onSelect={setActivePath} />
          {collab && activeFile ? (
            <Editor file={activeFile} provider={collab.provider} />
          ) : (
            <div className="editor-wrap" />
          )}
          <OutputPanel output={exec.output} />
        </div>
        <AgentPanel agent={agent} disabled={!connected} />
      </div>
    </div>
  );
}
