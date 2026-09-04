package run

import (
	"context"
	"sync"
	"time"

	"github.com/nickpatt/codesession/execution-service/internal/pool"
	"github.com/nickpatt/codesession/execution-service/internal/sandbox"
)

// Manager enforces "one run per session at a time" and makes runs cancellable.
//
// Each session id maps to at most one active run. Starting a run while one is
// already active for that session is rejected (the caller/UI disables Run while
// a program is running). Stop cancels the active run.
type Manager struct {
	docker  *sandbox.Docker
	pool    *pool.Pool
	timeout time.Duration

	mu     sync.Mutex
	active map[string]context.CancelFunc // sessionID -> cancel
}

// NewManager wires the manager to the container pool.
func NewManager(d *sandbox.Docker, p *pool.Pool, timeout time.Duration) *Manager {
	return &Manager{
		docker:  d,
		pool:    p,
		timeout: timeout,
		active:  make(map[string]context.CancelFunc),
	}
}

// ErrBusy is returned when a session already has a run in flight.
type ErrBusy struct{}

func (ErrBusy) Error() string { return "a run is already active for this session" }

// Start executes code for a session, emitting Events on the returned channel
// until the run finishes. The channel is closed when the run ends. Only one run
// per session may be active at once.
func (m *Manager) Start(sessionID, code string) (<-chan Event, error) {
	m.mu.Lock()
	if _, busy := m.active[sessionID]; busy {
		m.mu.Unlock()
		return nil, ErrBusy{}
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.active[sessionID] = cancel
	m.mu.Unlock()

	events := make(chan Event, 64)

	go func() {
		defer close(events)
		defer func() {
			m.mu.Lock()
			delete(m.active, sessionID)
			m.mu.Unlock()
			cancel()
		}()

		// Acquire a warm container (bounded wait so we don't hang if Docker is
		// unhealthy).
		acqCtx, acqCancel := context.WithTimeout(ctx, 15*time.Second)
		id, err := m.pool.Acquire(acqCtx)
		acqCancel()
		if err != nil {
			events <- Event{Type: EventError, Data: "could not acquire sandbox: " + err.Error()}
			return
		}
		// The container is single-use; always remove it when done.
		defer m.docker.Remove(context.Background(), id)

		// Bridge sandbox output chunks to typed events.
		chunks := make(chan sandbox.OutputChunk, 64)
		done := make(chan sandbox.Result, 1)
		go func() {
			res, runErr := m.docker.Run(ctx, id, code, m.timeout, chunks)
			close(chunks)
			if runErr != nil {
				events <- Event{Type: EventError, Data: runErr.Error()}
			}
			done <- res
		}()

		for c := range chunks {
			t := EventStdout
			if c.Stderr {
				t = EventStderr
			}
			events <- Event{Type: t, Data: string(c.Data)}
		}
		res := <-done
		events <- Event{Type: EventExit, ExitCode: res.ExitCode, Reason: res.Reason}
	}()

	return events, nil
}

// StartProject runs a multi-file project for a session (used by the AI agent to
// validate its edits, e.g. by running pytest). Same one-run-per-session and
// cancellation semantics as Start.
func (m *Manager) StartProject(sessionID string, proj sandbox.Project) (<-chan Event, error) {
	m.mu.Lock()
	if _, busy := m.active[sessionID]; busy {
		m.mu.Unlock()
		return nil, ErrBusy{}
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.active[sessionID] = cancel
	m.mu.Unlock()

	events := make(chan Event, 64)

	go func() {
		defer close(events)
		defer func() {
			m.mu.Lock()
			delete(m.active, sessionID)
			m.mu.Unlock()
			cancel()
		}()

		acqCtx, acqCancel := context.WithTimeout(ctx, 15*time.Second)
		id, err := m.pool.Acquire(acqCtx)
		acqCancel()
		if err != nil {
			events <- Event{Type: EventError, Data: "could not acquire sandbox: " + err.Error()}
			return
		}
		defer m.docker.Remove(context.Background(), id)

		chunks := make(chan sandbox.OutputChunk, 64)
		done := make(chan sandbox.Result, 1)
		go func() {
			res, runErr := m.docker.RunProject(ctx, id, proj, m.timeout, chunks)
			close(chunks)
			if runErr != nil {
				events <- Event{Type: EventError, Data: runErr.Error()}
			}
			done <- res
		}()

		for c := range chunks {
			t := EventStdout
			if c.Stderr {
				t = EventStderr
			}
			events <- Event{Type: t, Data: string(c.Data)}
		}
		res := <-done
		events <- Event{Type: EventExit, ExitCode: res.ExitCode, Reason: res.Reason}
	}()

	return events, nil
}

// Stop cancels the active run for a session, if any. Returns true if a run was
// actually cancelled.
func (m *Manager) Stop(sessionID string) bool {
	m.mu.Lock()
	cancel, ok := m.active[sessionID]
	m.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}
