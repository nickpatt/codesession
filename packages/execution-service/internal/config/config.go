// Package config centralizes runtime configuration for the execution-service,
// read from environment variables with safe defaults. Keeping every tunable in
// one place makes the sandbox's security posture easy to audit at a glance.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all runtime settings for the service and the sandbox limits.
type Config struct {
	// Port the HTTP server listens on.
	Port string

	// Image is the Docker image user code runs inside.
	Image string

	// --- Sandbox resource limits (defense in depth) ---

	// CPUs is the fractional CPU cap per run (e.g. 0.5 = half a core).
	CPUs float64
	// MemoryBytes caps container memory; exceeding it triggers an OOM kill.
	MemoryBytes int64
	// PidsLimit caps the number of processes/threads (stops fork bombs).
	PidsLimit int64
	// Timeout is the wall-clock limit before a run is force-killed.
	Timeout time.Duration
	// ScratchBytes is the size of the writable tmpfs mounted at /scratch.
	ScratchBytes int64

	// --- Warm pool ---

	// PoolSize is how many containers to keep pre-started and idle.
	PoolSize int
}

// Load builds a Config from the environment, applying defaults.
func Load() Config {
	return Config{
		Port:         env("PORT", "9090"),
		Image:        env("SANDBOX_IMAGE", "codesession-runner:latest"),
		CPUs:         envFloat("SANDBOX_CPUS", 0.5),
		MemoryBytes:  envInt64("SANDBOX_MEM_BYTES", 256*1024*1024),   // 256 MB
		PidsLimit:    envInt64("SANDBOX_PIDS", 128),                  //
		Timeout:      time.Duration(envInt64("SANDBOX_TIMEOUT_MS", 30_000)) * time.Millisecond,
		ScratchBytes: envInt64("SANDBOX_SCRATCH_BYTES", 32*1024*1024), // 32 MB
		PoolSize:     int(envInt64("POOL_SIZE", 3)),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}
