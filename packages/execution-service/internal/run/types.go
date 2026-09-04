// Package run defines the request/response types and streaming events shared by
// the execution-service HTTP layer and the sandbox that carries out a run.
package run

// Request is the body of POST /run.
type Request struct {
	// SessionID identifies which collaborative session triggered the run. The
	// service enforces one active run per session at a time.
	SessionID string `json:"sessionId"`
	// Code is the (untrusted) Python source to execute.
	Code string `json:"code"`
}

// ProjectRequest is the body of POST /run-project. It runs a whole multi-file
// project (what the AI agent works with) rather than a single script.
type ProjectRequest struct {
	SessionID string `json:"sessionId"`
	// Files maps a project-relative path to its contents.
	Files map[string]string `json:"files"`
	// Command is the argv to run (e.g. ["python","-m","pytest","-q"]). Optional;
	// defaults to pytest when empty.
	Command []string `json:"command,omitempty"`
}

// EventType tags each streamed output event.
type EventType string

const (
	// EventStdout carries a chunk of the program's standard output.
	EventStdout EventType = "stdout"
	// EventStderr carries a chunk of the program's standard error.
	EventStderr EventType = "stderr"
	// EventExit is the final event: the program finished (or was killed).
	EventExit EventType = "exit"
	// EventError signals an infrastructure problem (not the user's code fault).
	EventError EventType = "error"
)

// Event is one item in the NDJSON stream returned by POST /run. Exactly one
// Event with Type == EventExit (or EventError) ends every stream.
type Event struct {
	Type EventType `json:"type"`
	// Data holds output text for stdout/stderr, or a message for error.
	Data string `json:"data,omitempty"`
	// ExitCode is set on EventExit (0 = success; 137 = killed/OOM, etc.).
	ExitCode int `json:"exitCode,omitempty"`
	// Reason gives a human-friendly cause on EventExit when non-zero, e.g.
	// "timeout", "out of memory", "cancelled".
	Reason string `json:"reason,omitempty"`
}
