package sandbox

import (
	"context"
	"errors"
	"io"
	"path"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
)

// Project is a set of files (path -> contents) to run together. This is what
// the agent works with: a small multi-file project rather than a single script.
type Project struct {
	// Files maps a relative path (e.g. "src/calc.py") to its text contents.
	Files map[string]string
	// Command is the argv to run inside the project dir, e.g.
	// ["python", "-m", "pytest", "-q"]. If empty, a sensible default is used.
	Command []string
}

// defaultCommand runs pytest quietly, which is how the agent validates test
// fixes. Kept in one place so callers don't have to repeat it.
var defaultCommand = []string{"python", "-m", "pytest", "-q"}

// writeProject writes each project file into /scratch inside the container.
//
// We write via `docker exec` piping the contents over stdin, rather than
// Docker's CopyToContainer, because /scratch is a tmpfs mount and CopyToContainer
// does not reliably land files on a tmpfs. Piping over stdin also means we never
// build shell strings from untrusted file contents — no injection surface.
func (d *Docker) writeProject(ctx context.Context, id string, files map[string]string) error {
	for p, content := range files {
		clean := sanitizePath(p)
		if clean == "" {
			continue // skip anything that tried to escape /scratch
		}
		if err := d.writeFile(ctx, id, "/scratch/"+clean, content); err != nil {
			return err
		}
	}
	return nil
}

// writeFile creates parent dirs then writes one file's contents via stdin.
func (d *Docker) writeFile(ctx context.Context, id, absPath, content string) error {
	// Ensure the parent directory exists (files may live under src/, tests/…).
	dir := path.Dir(absPath)
	if dir != "" && dir != "/scratch" {
		if err := d.execSimple(ctx, id, []string{"mkdir", "-p", dir}); err != nil {
			return err
		}
	}

	execCfg := container.ExecOptions{
		Cmd:          []string{"cp", "/dev/stdin", absPath},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
	}
	created, err := d.cli.ContainerExecCreate(ctx, id, execCfg)
	if err != nil {
		return err
	}
	att, err := d.cli.ContainerExecAttach(ctx, created.ID, container.ExecAttachOptions{})
	if err != nil {
		return err
	}
	defer att.Close()

	if _, err := att.Conn.Write([]byte(content)); err != nil {
		return err
	}
	if cw, ok := att.Conn.(interface{ CloseWrite() error }); ok {
		_ = cw.CloseWrite()
	}
	_, _ = io.Copy(io.Discard, att.Reader)
	return nil
}

// execSimple runs a short command and waits for it to finish, discarding output.
func (d *Docker) execSimple(ctx context.Context, id string, cmd []string) error {
	created, err := d.cli.ContainerExecCreate(ctx, id, container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return err
	}
	att, err := d.cli.ContainerExecAttach(ctx, created.ID, container.ExecAttachOptions{})
	if err != nil {
		return err
	}
	defer att.Close()
	_, _ = io.Copy(io.Discard, att.Reader)
	return nil
}

// sanitizePath normalizes a project-relative path and rejects attempts to
// escape the scratch directory (absolute paths, "..", etc.). Returns "" if the
// path is unsafe.
func sanitizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	// Disallow absolute paths and parent traversal.
	clean := path.Clean("/" + p) // forces it under root, collapses ".."
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || strings.HasPrefix(clean, "../") || clean == ".." {
		return ""
	}
	return clean
}

// RunProject writes a multi-file project into the sandbox and runs Command,
// streaming output. Same containment guarantees as Run: the container is
// disposable and force-removed on timeout/cancel.
func (d *Docker) RunProject(
	ctx context.Context,
	id string,
	proj Project,
	timeout time.Duration,
	out chan<- OutputChunk,
) (Result, error) {
	if err := d.writeProject(ctx, id, proj.Files); err != nil {
		return Result{}, err
	}

	cmd := proj.Command
	if len(cmd) == 0 {
		cmd = defaultCommand
	}

	execCfg := container.ExecOptions{
		Cmd:          cmd,
		WorkingDir:   "/scratch",
		AttachStdout: true,
		AttachStderr: true,
	}
	created, err := d.cli.ContainerExecCreate(ctx, id, execCfg)
	if err != nil {
		return Result{}, err
	}
	att, err := d.cli.ContainerExecAttach(ctx, created.ID, container.ExecAttachOptions{})
	if err != nil {
		return Result{}, err
	}
	defer att.Close()

	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	copyDone := make(chan error, 1)
	go func() { copyDone <- demux(att.Reader, out) }()

	select {
	case <-runCtx.Done():
		_ = d.Remove(context.Background(), id)
		reason := "cancelled"
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			reason = "timeout"
		}
		select {
		case <-copyDone:
		case <-time.After(3 * time.Second):
		}
		return Result{ExitCode: 137, Reason: reason}, nil

	case err := <-copyDone:
		if err != nil && !errors.Is(err, io.EOF) {
			return Result{}, err
		}
		insp, ierr := d.cli.ContainerExecInspect(context.Background(), created.ID)
		if ierr != nil {
			return Result{}, ierr
		}
		res := Result{ExitCode: insp.ExitCode}
		if insp.ExitCode == 137 {
			res.Reason = "out of memory"
		}
		return res, nil
	}
}
