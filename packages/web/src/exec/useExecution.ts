import { useEffect, useRef, useState } from "react";
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
  /** True while the control socket is connected. */
  ready: boolean;
  run: () => void;
  stop: () => void;
  clear: () => void;
}

/** Build the control WebSocket URL for a session from the page origin. */
function controlUrl(sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/control/${sessionId}`;
}

/**
 * Drives the Run/Stop controls and the shared output panel over a dedicated
 * control WebSocket (separate from the Yjs sync socket).
 *
 * Because the server fans run output to every control socket in the session,
 * all participants' panels update together in real time.
 */
export function useExecution(sessionId: string | null): ExecutionState {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [lastExit, setLastExit] = useState<ExecutionState["lastExit"]>(null);
  const [ready, setReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(controlUrl(sessionId));
      wsRef.current = ws;

      ws.onopen = () => setReady(true);
      ws.onclose = () => {
        setReady(false);
        // Reconnect the control channel so Run keeps working after blips.
        if (!closed) reconnectTimer = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        let msg: ServerControl;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        applyMessage(msg);
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function applyMessage(msg: ServerControl) {
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
          { stream: "system", text: exitLine(msg.exitCode, msg.reason) },
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
  }

  const send = (data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  return {
    running,
    output,
    lastExit,
    ready,
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
