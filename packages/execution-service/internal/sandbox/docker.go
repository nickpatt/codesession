// Package sandbox owns the Docker container lifecycle for running untrusted
// code. This file wires up the Docker SDK client; the actual per-run container
// creation and resource limits live alongside it.
package sandbox

import (
	"context"
	"fmt"

	"github.com/docker/docker/client"
)

// Docker wraps the Docker Engine API client used to create and control sandbox
// containers. Holding it in one struct keeps the SDK dependency contained.
type Docker struct {
	cli *client.Client
}

// NewDocker connects to the local Docker daemon using environment settings
// (DOCKER_HOST etc.), negotiating the API version so we work across daemons.
func NewDocker() (*Docker, error) {
	cli, err := client.NewClientWithOpts(
		client.FromEnv,
		client.WithAPIVersionNegotiation(),
	)
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
