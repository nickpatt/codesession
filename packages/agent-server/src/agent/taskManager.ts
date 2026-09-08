import type { AgentEvent } from "@codesession/shared";
import type { LLMProvider } from "../llm/index.js";
import { Orchestrator } from "./orchestrator.js";

let taskCounter = 0;

/** A running task and the handle to cancel it. */
interface RunningTask {
  orchestrator: Orchestrator;
  sessionId: string;
}

/**
 * Tracks active agent tasks and enforces one task per session at a time. This
 * is the small stateful layer between the HTTP API and the orchestrator.
 */
export class TaskManager {
  private active = new Map<string, RunningTask>(); // sessionId -> task

  constructor(private readonly llm: LLMProvider) {}

  /** Whether a session already has an agent task running. */
  isBusy(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /**
   * Start a task. Events are delivered to `emit` as they happen; the returned
   * promise resolves when the task finishes. Rejects if the session is busy.
   */
  async run(
    sessionId: string,
    prompt: string,
    emit: (event: AgentEvent) => void,
  ): Promise<void> {
    if (this.active.has(sessionId)) {
      throw new Error("an agent task is already running for this session");
    }
    const taskId = `task_${++taskCounter}`;
    const orchestrator = new Orchestrator(taskId, sessionId, prompt, this.llm, emit);
    this.active.set(sessionId, { orchestrator, sessionId });
    try {
      await orchestrator.run();
    } finally {
      this.active.delete(sessionId);
    }
  }

  /** Cancel the active task for a session, if any. */
  cancel(sessionId: string): boolean {
    const task = this.active.get(sessionId);
    if (!task) return false;
    task.orchestrator.cancel();
    return true;
  }
}
