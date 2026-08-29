package sandbox

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/pkg/stdcopy"
)

// OutputChunk is one piece of program output, tagged by which stream it came
// from. The run engine converts these into the NDJSON events sent to clients.
type OutputChunk struct {
	Stderr bool
	Data   []byte
}

// Result summarizes how a run ended.
type Result struct {
	ExitCode int
	// Reason is set for abnormal endings: "timeout", "out of memory",
	// "cancelled". Empty on a normal exit.
	Reason string
}

// writeCode places the user's source at /scratch/main.py inside the container by
// exec'ing a tiny writer. We pipe the code over stdin rather than building it
// into a command string, so no amount of quoting in user code can break out.
func (d *Docker) writeCode(ctx context.Context, id, code string) error {
	// `cat > /scratch/main.py` reads stdin and writes the file. cat is present
	// in the slim base image and needs no shell metacharacter handling.
	execCfg := container.ExecOptions{
		Cmd:          []string{"cp", "/dev/stdin", "/scratch/main.py"},
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

	if _, err := att.Conn.Write([]byte(code)); err != nil {
		return err
	}
	// Signal EOF so cp finishes.
	if cw, ok := att.Conn.(interface{ CloseWrite() error }); ok {
		_ = cw.CloseWrite()
	}
	// Drain any output so the exec completes.
	_, _ = io.Copy(io.Discard, att.Reader)
	return nil
}

// Run executes the user's Python inside the given (already-running) container,
// streaming output chunks to out until the program exits, the wall-clock
// timeout fires, or ctx is cancelled (Stop). It returns how the run ended.
//
// The container itself is disposable: the caller removes it afterward so no
// state leaks to the next run.
func (d *Docker) Run(
	ctx context.Context,
	id, code string,
	timeout time.Duration,
	out chan<- OutputChunk,
) (Result, error) {
	// Stage 1: write the code file.
	if err := d.writeCode(ctx, id, code); err != nil {
		return Result{}, err
	}

	// Stage 2: exec the interpreter. -I isolates the run from env-based imports;
	// -B skips writing bytecode (rootfs is read-only anyway).
	execCfg := container.ExecOptions{
		Cmd:          []string{"python", "-I", "-B", "/scratch/main.py"},
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

	// Apply the wall-clock timeout on top of any caller cancellation.
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Copy the multiplexed docker stream into our tagged chunk channel.
	copyDone := make(chan error, 1)
	go func() {
		copyDone <- demux(att.Reader, out)
	}()

	select {
	case <-runCtx.Done():
		// Timed out or cancelled. Force-removing the container kills every
		// process inside it AND closes the attached output stream, which is what
		// unblocks the copier below. This is the hard guarantee that a runaway
		// program (infinite loop, etc.) actually stops.
		_ = d.Remove(context.Background(), id)
		reason := "cancelled"
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			reason = "timeout"
		}
		// Wait for the copier to unwind, but don't hang forever if the stream
		// is slow to close after removal.
		select {
		case <-copyDone:
		case <-time.After(3 * time.Second):
		}
		return Result{ExitCode: 137, Reason: reason}, nil

	case err := <-copyDone:
		// Program finished on its own; inspect the exec for its exit code.
		if err != nil && !errors.Is(err, io.EOF) {
			return Result{}, err
		}
		insp, ierr := d.cli.ContainerExecInspect(context.Background(), created.ID)
		if ierr != nil {
			return Result{}, ierr
		}
		res := Result{ExitCode: insp.ExitCode}
		// Exit 137 = SIGKILL, which for us usually means the OOM killer fired.
		if insp.ExitCode == 137 {
			res.Reason = "out of memory"
		}
		return res, nil
	}
}

// demux splits Docker's multiplexed stdout/stderr stream into tagged chunks.
// Docker frames each with a header saying which stream and how many bytes; we
// use stdcopy to peel them apart, writing into small buffers we forward on.
func demux(r io.Reader, out chan<- OutputChunk) error {
	stdoutW := &chanWriter{out: out, stderr: false}
	stderrW := &chanWriter{out: out, stderr: true}
	_, err := stdcopy.StdCopy(stdoutW, stderrW, r)
	return err
}

// chanWriter adapts an io.Writer into sends on the output channel.
type chanWriter struct {
	out    chan<- OutputChunk
	stderr bool
}

func (w *chanWriter) Write(p []byte) (int, error) {
	// Copy p: StdCopy reuses its buffer, so we must not retain the slice.
	buf := make([]byte, len(p))
	copy(buf, p)
	w.out <- OutputChunk{Stderr: w.stderr, Data: buf}
	return len(p), nil
}


