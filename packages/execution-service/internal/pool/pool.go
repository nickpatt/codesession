// Package pool maintains a set of pre-started ("warm") sandbox containers so a
// run can begin immediately instead of paying the ~1s cost of creating and
// starting a container on the critical path.
//
// Isolation model: a warm container is handed out for exactly one run and is
// then destroyed — never reused for a second run. This keeps the latency win
// (we skip create+start for the *next* run because a replacement is spun up in
// the background) without ever leaking one user's state into another's run.
package pool

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/nickpatt/codesession/execution-service/internal/sandbox"
)

// Pool holds ready-to-use container ids and refills itself in the background.
type Pool struct {
	docker *sandbox.Docker
	limits sandbox.Limits
	size   int

	ready chan string // buffered channel of warm container ids

	mu     sync.Mutex
	closed bool
}

// New creates a pool and eagerly fills it to `size` warm containers.
func New(d *sandbox.Docker, limits sandbox.Limits, size int) *Pool {
	p := &Pool{
		docker: d,
		limits: limits,
		size:   size,
		ready:  make(chan string, size),
	}
	for i := 0; i < size; i++ {
		p.spawn()
	}
	return p
}

// spawn creates one warm container and enqueues it. Runs in the background so
// filling the pool never blocks a caller.
func (p *Pool) spawn() {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		id, err := p.docker.Create(ctx, p.limits)
		if err != nil {
			log.Printf("[pool] spawn failed: %v", err)
			return
		}
		p.mu.Lock()
		closed := p.closed
		p.mu.Unlock()
		if closed {
			_ = p.docker.Remove(context.Background(), id)
			return
		}
		p.ready <- id
	}()
}

// Acquire returns a warm container id, waiting up to the context deadline. It
// immediately kicks off a replacement so the pool stays full. The returned
// container is the caller's to use once and then discard.
func (p *Pool) Acquire(ctx context.Context) (string, error) {
	select {
	case id := <-p.ready:
		p.spawn() // refill in the background
		return id, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// AcquireCold bypasses the pool: it creates a container on the spot. Used to
// measure the cold-start baseline for the warm-vs-cold latency metric.
func (p *Pool) AcquireCold(ctx context.Context) (string, error) {
	return p.docker.Create(ctx, p.limits)
}

// Warm reports how many containers are ready right now (for metrics/debug).
func (p *Pool) Warm() int {
	return len(p.ready)
}

// Close drains and removes all warm containers. Call on shutdown so we don't
// leak containers.
func (p *Pool) Close() {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()

	for {
		select {
		case id := <-p.ready:
			_ = p.docker.Remove(context.Background(), id)
		default:
			return
		}
	}
}
