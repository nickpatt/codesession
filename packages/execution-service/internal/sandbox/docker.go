// Package sandbox owns the Docker container lifecycle for running untrusted
// code. This file wires up the Docker SDK client; the actual per-run container
// creation and resource limits live alongside it.
package sandbox

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/docker/docker/client"
)

// Docker wraps the Docker Engine API client used to create and control sandbox
// containers. Holding it in one struct keeps the SDK dependency contained.
type Docker struct {
	cli *client.Client
}

// NewDocker connects to the local Docker daemon, negotiating the API version so
// we work across daemon versions.
//
// It honors DOCKER_HOST when set. Otherwise, because Docker Desktop on macOS
// listens on a per-user socket (~/.docker/run/docker.sock) rather than the
// classic /var/run/docker.sock, we fall back to that user socket if it exists.
func NewDocker() (*Docker, error) {
	opts := []client.Opt{client.FromEnv, client.WithAPIVersionNegotiation()}

	if os.Getenv("DOCKER_HOST") == "" {
		if home, err := os.UserHomeDir(); err == nil {
			userSock := filepath.Join(home, ".docker", "run", "docker.sock")
			if _, err := os.Stat(userSock); err == nil {
				opts = append(opts, client.WithHost("unix://"+userSock))
			}
		}
	}

	cli, err := client.NewClientWithOpts(opts...)
	if err != nil {
		return nil, fmt.Errorf("connect to docker: %w", err)
	}
	return &Docker{cli: cli}, nil
}

// Ping verifies the daemon is reachable; called at startup so we fail fast with
// a clear message rather than on the first run.
func (d *Docker) Ping(ctx context.Context) error {
	_, err := d.cli.Ping(ctx)
	if err != nil {
		return fmt.Errorf("docker ping: %w", err)
	}
	return nil
}

// Close releases the underlying HTTP client.
func (d *Docker) Close() error {
	return d.cli.Close()
}
