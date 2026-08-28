package sandbox

import (
	"context"
	"fmt"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/go-connections/nat"

	"github.com/nickpatt/codesession/execution-service/internal/config"
)

// Limits captures the security-relevant knobs for a sandbox container. They are
// grouped here so the whole containment policy is visible in one place — this is
// exactly the "explain the exact controls" surface the project is built to show.
type Limits struct {
	Image        string
	CPUs         float64
	MemoryBytes  int64
	PidsLimit    int64
	ScratchBytes int64
}

// LimitsFromConfig lifts the sandbox knobs out of the service config.
func LimitsFromConfig(c config.Config) Limits {
	return Limits{
		Image:        c.Image,
		CPUs:         c.CPUs,
		MemoryBytes:  c.MemoryBytes,
		PidsLimit:    c.PidsLimit,
		ScratchBytes: c.ScratchBytes,
	}
}

// hostConfig builds the Docker HostConfig that enforces our sandbox policy.
//
// Defense in depth — every line here is a distinct control, and no single one
// is trusted on its own:
//   - NetworkMode "none": the container has no network interfaces at all, so
//     user code cannot exfiltrate data or pull anything down.
//   - Memory + MemorySwap equal: caps total memory AND disables swap, so a
//     memory bomb is OOM-killed instead of thrashing swap.
//   - NanoCPUs: fractional CPU cap so a busy loop can't starve the host.
//   - PidsLimit: caps processes/threads, which contains fork bombs.
//   - ReadonlyRootfs: the whole filesystem is read-only...
//   - ...except a small, size-capped tmpfs at /scratch for the program's files.
//   - CapDrop ALL + no-new-privileges: drop every Linux capability and forbid
//     privilege escalation (e.g. via setuid binaries).
func hostConfig(l Limits) *container.HostConfig {
	return &container.HostConfig{
		// No network whatsoever.
		NetworkMode: "none",

		Resources: container.Resources{
			// NanoCPUs is CPUs expressed in billionths of a core.
			NanoCPUs:  int64(l.CPUs * 1e9),
			Memory:    l.MemoryBytes,
			MemorySwap: l.MemoryBytes, // equal => swap disabled
			PidsLimit: &l.PidsLimit,
		},

		// Read-only root filesystem; only /scratch is writable (and size-capped).
		ReadonlyRootfs: true,
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeTmpfs,
				Target: "/scratch",
				TmpfsOptions: &mount.TmpfsOptions{
					SizeBytes: l.ScratchBytes,
					Mode:      0o770,
				},
			},
		},

		// Drop all Linux capabilities and forbid gaining new privileges.
		CapDrop:     []string{"ALL"},
		SecurityOpt: []string{"no-new-privileges"},

		// Never auto-restart a sandbox; each run is one-shot.
		RestartPolicy: container.RestartPolicy{Name: "no"},
	}
}

// containerConfig builds the container spec. The container starts idle (the
// image's CMD is `sleep infinity`); we inject the actual run via exec so the
// same warm container can be reused.
func containerConfig(l Limits) *container.Config {
	return &container.Config{
		Image:           l.Image,
		WorkingDir:      "/scratch",
		NetworkDisabled: true,
		Tty:             false,
		// No exposed ports; declared empty explicitly for clarity.
		ExposedPorts: nat.PortSet{},
		// Labels let us find/clean up our containers even after a crash.
		Labels: map[string]string{"app": "codesession-sandbox"},
	}
}

// Create starts a new idle sandbox container with the given limits and returns
// its id. The container is running but doing nothing until code is exec'd in.
func (d *Docker) Create(ctx context.Context, l Limits) (string, error) {
	resp, err := d.cli.ContainerCreate(
		ctx,
		containerConfig(l),
		hostConfig(l),
		nil, // no custom networking config
		nil, // no platform override
		"",  // random name
	)
	if err != nil {
		return "", fmt.Errorf("create container: %w", err)
	}
	if err := d.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		// Best-effort cleanup if start fails.
		_ = d.Remove(context.Background(), resp.ID)
		return "", fmt.Errorf("start container: %w", err)
	}
	return resp.ID, nil
}

// Remove force-deletes a container. Used after each run (isolation) and when
// draining the pool at shutdown.
func (d *Docker) Remove(ctx context.Context, id string) error {
	return d.cli.ContainerRemove(ctx, id, container.RemoveOptions{
		Force:         true,
		RemoveVolumes: true,
	})
}
