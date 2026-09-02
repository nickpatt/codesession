import { useEffect, useRef, useState } from "react";
import type { WebsocketProvider } from "y-websocket";
import type { ServerControl } from "@codesession/shared";

/** One line/segment of program output in the shared panel. */
export interface OutputLine {
  stream: "stdout" | "stderr" | "system";
  text: string;
}

/** Shared run state, identical for every participant in the session. */
export interface ExecutionState {
  running: boolean;
  output: OutputLine[];
  /** The last exit summary, if any. */
  lastExit: { exitCode: number; reason?: string } | null;
  run: () => void;
  stop: () => void;
  clear: () => void;
}

/**
 * Drives the Run/Stop controls and the shared output panel.
 *
 * We piggyback on the same WebSocket that y-websocket already manages for the
 * session: control messages travel as JSON *text* frames, while Yjs uses binary
 * frames, so the two never collide. Because the server fans run output to every
 * client, all participants' panels update together.
 */
export function useExecution(provider: WebsocketProvider | null): ExecutionState {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [lastExit, setLastExit] = useState<ExecutionState["lastExit"]>(null);
  // Keep a ref to the socket so run()/stop() can send without re-subscribing.
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!provider) return;

    // y-websocket recreates the socket on reconnect; poll the current one.
    const attach = () => {
      wsRef.current = provider.ws ?? null;
    };
    attach();
    provider.on("status", attach);

    const onMessage = (ev: MessageEvent) => {
      // Only handle text frames (our control channel). Binary is Yjs.
      if (typeof ev.data !== "string") return;
      let msg: ServerControl;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "run-started":
          setRunning(true);
          setLastExit(null);
          setOutput([{ stream: "system", text: "▶ Running…\n" }]);
          break;
        case "run-output":
          setOutput((prev) => [...prev, { stream: msg.stream, text: msg.data }]);
          break;
        case "run-exit":
          setRunning(false);
          setLastExit({ exitCode: msg.exitCode, reason: msg.reason });
          setOutput((prev) => [
            ...prev,
            {
              stream: "system",
              text: exitLine(msg.exitCode, msg.reason),
            },
          ]);
          break;
        case "run-error":
          setRunning(false);
          setOutput((prev) => [
            ...prev,
            { stream: "stderr", text: `\n[error] ${msg.message}\n` },
          ]);
          break;
      }
    };

    // Attach a raw listener to the underlying socket. We re-attach on status
    // changes because the socket instance can be swapped on reconnect.
    const bind = () => provider.ws?.addEventListener("message", onMessage);
    const unbind = () => provider.ws?.removeEventListener("message", onMessage);
    bind();
    const rebind = () => {
      unbind();
      bind();
      attach();
    };
    provider.on("status", rebind);

    return () => {
      unbind();
      provider.off("status", attach);
      provider.off("status", rebind);
    };
  }, [provider]);

  const send = (data: unknown) => {
    const ws = provider?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  return {
    running,
    output,
    lastExit,
    run: () => send({ type: "run" }),
    stop: () => send({ type: "stop" }),
    clear: () => {
      setOutput([]);
      setLastExit(null);
    },
  };
}

/** Human-friendly summary line appended when a run ends. */
function exitLine(exitCode: number, reason?: string): string {
  if (reason === "timeout") return "\n⏱ Killed: exceeded time limit\n";
  if (reason === "out of memory") return "\n💥 Killed: out of memory\n";
  if (reason === "cancelled") return "\n■ Stopped\n";
  if (exitCode === 0) return "\n✔ Finished (exit 0)\n";
  return `\n✖ Exited with code ${exitCode}\n`;
}
