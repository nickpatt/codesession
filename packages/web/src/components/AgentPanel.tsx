import { useState } from "react";
import type { AgentState } from "../agent/useAgent.js";

/**
 * The AI Agent panel (spec section 14). Lets a user give the agent a task,
 * watch its steps stream in live, see test output, and read the result. Since
 * the agent's activity is broadcast to everyone, this panel looks the same for
 * all collaborators.
 */
export function AgentPanel({ agent, disabled }: { agent: AgentState; disabled: boolean }) {
  const [prompt, setPrompt] = useState("Fix the failing tests.");

  const submit = () => {
    const p = prompt.trim();
    if (p && !agent.running) agent.start(p);
  };

  return (
    <div className="agent-panel">
      <div className="agent-header">AI Agent</div>

      <div className="agent-input">
        <textarea
          value={prompt}
          disabled={agent.running}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a coding task…"
          rows={2}
        />
        {agent.running ? (
          <button className="stop" onClick={agent.cancel}>
            ■ Cancel
          </button>
        ) : (
          <button onClick={submit} disabled={disabled || !prompt.trim()}>
            ▸ Run Agent
          </button>
        )}
      </div>

      <div className="agent-steps">
        {agent.steps.length === 0 && (
          <span className="agent-empty">
            Ask the agent to fix a bug, implement a function, or repair failing tests.
          </span>
        )}
        {agent.steps.map((s, i) => (
          <div key={i} className={`agent-step step-${s.kind}`}>
            <span className="bullet">●</span> {s.text}
          </div>
        ))}
      </div>

      {agent.output && (
        <details className="agent-output" open>
          <summary>Test output</summary>
          <pre>{agent.output}</pre>
        </details>
      )}

      {agent.result && (
        <div className={`agent-result ${agent.result.ok ? "ok" : "fail"}`}>
          {agent.result.ok ? "✓ " : "✗ "}
          {agent.result.summary}
        </div>
      )}
    </div>
  );
}
