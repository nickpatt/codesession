import type { AgentEvent, AgentAction, AgentStatus } from "@codesession/shared";
import type { LLMProvider } from "../llm/index.js";
import { ProjectClient } from "../session/projectClient.js";
import { runProject } from "../session/execClient.js";
import { retrieveContext } from "./context.js";
import { parseAction, ActionParseError } from "./actions.js";
import { Patcher } from "./patcher.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import { config } from "../config.js";

/** A sink the orchestrator uses to stream agent events to collaborators. */
export type EmitFn = (event: AgentEvent) => void;

/** Final outcome of a task. */
export interface AgentResult {
  status: "completed" | "failed" | "cancelled";
  iterations: number;
  summary: string;
}

/**
 * Runs a single agent task end to end (spec sections 2, 5, 18):
 *
 *   connect to the session doc  →  loop {
 *       retrieve context  →  ask the model for one action  →
 *       apply patch through Yjs (stale-checked)  →  run tests in sandbox  →
 *       decide: done? out of budget? otherwise feed results back and retry
 *   }
 *
 * Every step emits an event so all collaborators watch the agent work live, and
 * every edit flows through the shared CRDT so humans and the agent stay in sync.
 */
export class Orchestrator {
  private cancelled = false;
  private executions = 0;
  private tokensUsed = 0;
  private readonly startedAt = Date.now();

  constructor(
    private readonly taskId: string,
    private readonly sessionId: string,
    private readonly prompt: string,
    private readonly llm: LLMProvider,
    private readonly emit: EmitFn,
  ) {}

  /** Request cancellation; the loop stops at the next checkpoint. */
  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<AgentResult> {
    this.emit({ type: "agent.started", taskId: this.taskId, prompt: this.prompt });

    let project: ProjectClient;
    try {
      project = await ProjectClient.connect(this.sessionId);
    } catch (err) {
      return this.fail(`could not join session: ${(err as Error).message}`);
    }

    const patcher = new Patcher(project);
    let lastResult: Awaited<ReturnType<typeof runProject>> | null = null;

    try {
      for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
        if (this.checkBudgets()) return this.fail("budget exhausted", iteration - 1);
        if (this.cancelled) return this.cancel_(iteration - 1);

        // 1) Retrieve relevant context from the live document.
        this.status("retrieving_context");
        const context = retrieveContext(project, this.prompt, config.maxContextTokens);
        this.emit({
          type: "agent.context",
          taskId: this.taskId,
          files: context.files.map((f) => f.path),
        });

        // 2) Ask the model for the next action.
        this.status("generating");
        this.emit({ type: "agent.thinking", taskId: this.taskId, iteration });
        const userMessage = buildUserMessage(this.prompt, context, lastResult);
        const completion = await this.llm.complete({
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: 4000,
        });
        this.tokensUsed += completion.tokensUsed;

        let action: AgentAction;
        try {
          action = parseAction(completion.text);
        } catch (err) {
          if (err instanceof ActionParseError) {
            // Treat an unparseable response as a wasted iteration and retry.
            continue;
          }
          throw err;
        }
        this.emit({ type: "agent.action", taskId: this.taskId, action });

        // 3) Handle the action.
        if (action.action === "finish") {
          return this.complete(iteration, action.summary);
        }

        if (action.action === "edit_file" || action.action === "create_file") {
          this.status("applying_patch");
          const result = patcher.apply(action, context.versions);
          if (!result.ok) {
            // Stale (human edited concurrently) or invalid: loop to re-read
            // fresh context and try again rather than clobbering.
            continue;
          }
          this.emit({
            type: "agent.patch_applied",
            taskId: this.taskId,
            path: result.path,
          });
        }
        // read_file needs no side effect (context already includes files);
        // run_command falls through to execution below.

        // 4) Run the tests in the sandbox and feed the result back.
        this.status("executing");
        this.executions += 1;
        lastResult = await runProject(
          this.sessionId,
          project.snapshot(),
          (stream, data) =>
            this.emit({
              type: "agent.execution_output",
              taskId: this.taskId,
              stream,
              data,
            }),
        );
        this.emit({
          type: "agent.iteration_finished",
          taskId: this.taskId,
          iteration,
          exitCode: lastResult.exitCode,
        });

        // 5) Success check: tests passed => done.
        if (lastResult.exitCode === 0) {
          return this.complete(iteration, "All tests passing.");
        }
      }

      return this.fail("reached max iterations without passing tests");
    } finally {
      project.destroy();
    }
  }

  // --- helpers ---

  private checkBudgets(): boolean {
    if (this.executions >= config.maxExecutions) return true;
    if (this.tokensUsed >= config.maxContextTokens * 4) return true;
    if (Date.now() - this.startedAt > config.maxRuntimeMs) return true;
    return false;
  }

  private status(status: AgentStatus): void {
    this.emit({ type: "agent.status", taskId: this.taskId, status });
  }

  private complete(iterations: number, summary: string): AgentResult {
    this.emit({ type: "agent.completed", taskId: this.taskId, iterations, summary });
    return { status: "completed", iterations, summary };
  }

  private fail(reason: string, iterations = config.maxIterations): AgentResult {
    this.emit({ type: "agent.failed", taskId: this.taskId, reason });
    return { status: "failed", iterations, summary: reason };
  }

  private cancel_(iterations: number): AgentResult {
    this.emit({ type: "agent.failed", taskId: this.taskId, reason: "cancelled" });
    return { status: "cancelled", iterations, summary: "cancelled by user" };
  }
}
