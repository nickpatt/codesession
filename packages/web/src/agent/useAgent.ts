import { useEffect, useRef, useState } from "react";
import type { ServerControl, AgentAction, AgentStatus } from "@codesession/shared";

/** A single human-readable step shown in the agent panel timeline. */
export interface AgentStep {
  kind: "status" | "context" | "action" | "patch" | "iteration" | "done" | "error";
  text: string;
}

/** Live state of the AI agent for a session. */
export interface AgentState {
  running: boolean;
  status: AgentStatus | null;
  steps: AgentStep[];
  /** Streamed test output from the agent's sandbox runs. */
  output: string;
  result: { ok: boolean; summary: string; iterations?: number } | null;
  ready: boolean;
  start: (prompt: string) => void;
  cancel: () => void;
  reset: () => void;
}

function controlUrl(sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/control/${sessionId}`;
}

/**
 * Drives the AI Agent panel over a control WebSocket. Sends agent_task /
 * agent_cancel and consumes the agent.* events the server fans out. Because the
 * server broadcasts to every collaborator, all users see the agent's progress
 * at the same time.
 */
export function useAgent(sessionId: string | null): AgentState {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<AgentState["result"]>(null);
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
        if (!closed) reconnectTimer = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        let msg: ServerControl;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        apply(msg);
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

  function addStep(step: AgentStep) {
    setSteps((prev) => [...prev, step]);
  }

  function apply(msg: ServerControl) {
    switch (msg.type) {
      case "agent.started":
        setRunning(true);
        setStatus("queued");
        setSteps([{ kind: "status", text: `Task: ${msg.prompt}` }]);
        setOutput("");
        setResult(null);
        break;
      case "agent.status":
        setStatus(msg.status);
        break;
      case "agent.context":
        addStep({ kind: "context", text: `Read ${msg.files.join(", ")}` });
        break;
      case "agent.thinking":
        addStep({ kind: "status", text: `Thinking (iteration ${msg.iteration})…` });
        break;
      case "agent.action":
        addStep({ kind: "action", text: describeAction(msg.action) });
        break;
      case "agent.patch_applied":
        addStep({ kind: "patch", text: `Edited ${msg.path}` });
        break;
      case "agent.execution_output":
        setOutput((prev) => prev + msg.data);
        break;
      case "agent.iteration_finished":
        addStep({
          kind: "iteration",
          text: `Iteration ${msg.iteration}: tests ${msg.exitCode === 0 ? "passed" : "failed"}`,
        });
        break;
      case "agent.completed":
        setRunning(false);
        setStatus("completed");
        addStep({ kind: "done", text: `Completed in ${msg.iterations} iteration(s)` });
        setResult({ ok: true, summary: msg.summary, iterations: msg.iterations });
        break;
      case "agent.failed":
        setRunning(false);
        setStatus("failed");
        addStep({ kind: "error", text: `Failed: ${msg.reason}` });
        setResult({ ok: false, summary: msg.reason });
        break;
    }
  }

  const send = (data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  return {
    running,
    status,
    steps,
    output,
    result,
    ready,
    start: (prompt: string) => send({ type: "agent_task", prompt }),
    cancel: () => send({ type: "agent_cancel" }),
    reset: () => {
      setSteps([]);
      setOutput("");
      setResult(null);
      setStatus(null);
    },
  };
}

/** Turn a structured action into a short human-readable line. */
function describeAction(action: AgentAction): string {
  switch (action.action) {
    case "read_file":
      return `Read ${action.path}`;
    case "edit_file":
      return `Propose edit to ${action.path}`;
    case "create_file":
      return `Create ${action.path}`;
    case "run_command":
      return `Run tests`;
    case "finish":
      return `Finish: ${action.summary}`;
  }
}
