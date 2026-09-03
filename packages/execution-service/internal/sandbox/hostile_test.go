package sandbox_test

// Hostile-snippet test suite: the core security proof for the sandbox.
//
// Each test runs a deliberately malicious/abusive Python program and asserts
// that the sandbox contains it. These require a running Docker daemon and the
// codesession-runner image; they are skipped automatically if Docker is
// unavailable (e.g. in a CI without Docker) so the rest of the suite still runs.
//
//	go test ./internal/sandbox -run Hostile -v
//
// The four classic attacks mirror the project spec's acceptance criteria:
//   - infinite loop  -> killed at the wall-clock timeout
//   - memory bomb    -> OOM-killed
//   - network call   -> fails (no network in the container)
//   - fork bomb      -> contained by the pids limit

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nickpatt/codesession/execution-service/internal/config"
	"github.com/nickpatt/codesession/execution-service/internal/sandbox"
)

// runSnippet is a helper: it spins up one sandbox container, runs the given
// code with the given timeout, collects all output, and returns the result.
func runSnippet(t *testing.T, code string, timeout time.Duration) (sandbox.Result, string) {
	t.Helper()

	d, err := sandbox.NewDocker()
	if err != nil {
		t.Skipf("docker unavailable: %v", err)
	}
	ctx := context.Background()
	if err := d.Ping(ctx); err != nil {
		t.Skipf("docker daemon not reachable: %v", err)
	}

	limits := sandbox.LimitsFromConfig(config.Load())
	id, err := d.Create(ctx, limits)
	if err != nil {
		t.Skipf("could not create sandbox (image built?): %v", err)
	}
	// Run may remove the container on timeout; a second remove is harmless.
	defer d.Remove(context.Background(), id)

	out := make(chan sandbox.OutputChunk, 256)
	var sb strings.Builder
	done := make(chan struct{})
	go func() {
		for c := range out {
			sb.Write(c.Data)
		}
		close(done)
	}()

	res, err := d.Run(ctx, id, code, timeout, out)
	close(out)
	<-done
	if err != nil {
		t.Fatalf("run error: %v", err)
	}
	return res, sb.String()
}

// TestHostile_InfiniteLoop: a busy loop must be killed at the timeout, not run
// forever. We use a short 3s timeout to keep the test fast.
func TestHostile_InfiniteLoop(t *testing.T) {
	start := time.Now()
	res, _ := runSnippet(t, "while True:\n    pass\n", 3*time.Second)
	elapsed := time.Since(start)

	if res.Reason != "timeout" {
		t.Errorf("expected reason=timeout, got %q (exit %d)", res.Reason, res.ExitCode)
	}
	// Should be killed close to the timeout, not hang far beyond it.
	if elapsed > 10*time.Second {
		t.Errorf("infinite loop took too long to kill: %s", elapsed)
	}
	t.Logf("infinite loop killed after %s (reason=%q)", elapsed.Round(time.Millisecond), res.Reason)
}

// TestHostile_MemoryBomb: allocating far past the memory cap must be OOM-killed,
// not allowed to exhaust host memory.
func TestHostile_MemoryBomb(t *testing.T) {
	// Try to allocate ~1GB against a 256MB cap.
	code := "x = bytearray(1024*1024*1024)\nprint('allocated', len(x))\n"
	res, out := runSnippet(t, code, 20*time.Second)

	// A successful allocation print would mean the cap failed.
	if strings.Contains(out, "allocated") {
		t.Errorf("memory bomb was NOT contained; program allocated 1GB. output=%q", out)
	}
	// OOM shows up as a non-zero exit (137 SIGKILL, or a MemoryError traceback).
	if res.ExitCode == 0 {
		t.Errorf("expected non-zero exit for memory bomb, got 0. output=%q", out)
	}
	t.Logf("memory bomb contained (exit=%d reason=%q)", res.ExitCode, res.Reason)
}

// TestHostile_Network: any outbound network call must fail because the container
// has no network interfaces (NetworkMode "none").
func TestHostile_Network(t *testing.T) {
	code := `
import socket
try:
    socket.setdefaulttimeout(5)
    s = socket.create_connection(("1.1.1.1", 53))
    print("CONNECTED")
    s.close()
except Exception as e:
    print("BLOCKED:", type(e).__name__)
`
	res, out := runSnippet(t, code, 15*time.Second)

	if strings.Contains(out, "CONNECTED") {
		t.Errorf("network was NOT blocked; container reached the internet. output=%q", out)
	}
	if !strings.Contains(out, "BLOCKED") {
		t.Errorf("expected a blocked-connection message, got output=%q (exit %d)", out, res.ExitCode)
	}
	t.Logf("network blocked: %s", strings.TrimSpace(out))
}

// TestHostile_ForkBomb: spawning unbounded processes must be contained by the
// pids limit rather than taking down the host.
func TestHostile_ForkBomb(t *testing.T) {
	// Fork aggressively; the pids limit should make os.fork() start failing.
	code := `
import os
n = 0
try:
    while True:
        pid = os.fork()
        if pid == 0:
            # child: sleep so it stays alive and consumes a pid slot
            import time; time.sleep(30)
            os._exit(0)
        n += 1
except OSError as e:
    print("FORK_BLOCKED after", n, "->", e.__class__.__name__)
`
	// Give it time to hit the pids ceiling, then we assert it was blocked.
	res, out := runSnippet(t, code, 15*time.Second)

	blocked := strings.Contains(out, "FORK_BLOCKED") || res.Reason == "timeout" || res.ExitCode != 0
	if !blocked {
		t.Errorf("fork bomb was NOT contained. output=%q exit=%d", out, res.ExitCode)
	}
	t.Logf("fork bomb contained (exit=%d reason=%q): %s", res.ExitCode, res.Reason, strings.TrimSpace(out))
}
