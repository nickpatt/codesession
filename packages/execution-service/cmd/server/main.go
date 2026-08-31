// Command server is the entrypoint for the CodeSession execution-service.
//
// It wires together: the Docker client, a warm container pool, the per-session
// run manager, and the HTTP API (streaming /run + /stop). User code runs in
// locked-down, disposable containers — see internal/sandbox for the controls.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nickpatt/codesession/execution-service/internal/config"
	"github.com/nickpatt/codesession/execution-service/internal/httpapi"
	"github.com/nickpatt/codesession/execution-service/internal/pool"
	"github.com/nickpatt/codesession/execution-service/internal/run"
	"github.com/nickpatt/codesession/execution-service/internal/sandbox"
)

func main() {
	cfg := config.Load()

	// Connect to Docker and fail fast if it's unreachable.
	docker, err := sandbox.NewDocker()
	if err != nil {
		log.Fatalf("[execution-service] docker: %v", err)
	}
	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := docker.Ping(pingCtx); err != nil {
		cancel()
		log.Fatalf("[execution-service] docker unreachable: %v", err)
	}
	cancel()

	// Remove any sandbox containers left over from a previous (unclean) run.
	if n, err := docker.CleanupOrphans(context.Background()); err != nil {
		log.Printf("[execution-service] orphan cleanup: %v", err)
	} else if n > 0 {
		log.Printf("[execution-service] cleaned up %d orphaned container(s)", n)
	}

	// Warm pool of pre-started sandbox containers.
	limits := sandbox.LimitsFromConfig(cfg)
	warm := pool.New(docker, limits, cfg.PoolSize)
	defer warm.Close()
	log.Printf("[execution-service] warming pool to %d containers", cfg.PoolSize)

	// Per-session run manager + HTTP API.
	manager := run.NewManager(docker, warm, cfg.Timeout)
	api := httpapi.New(manager)

	srv := &http.Server{Addr: ":" + cfg.Port, Handler: api.Routes()}

	// Graceful shutdown: drain the pool, stop the server.
	go func() {
		sigs := make(chan os.Signal, 1)
		signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
		<-sigs
		log.Println("[execution-service] shutting down")
		warm.Close()
		ctx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(ctx)
	}()

	log.Printf("[execution-service] listening on :%s", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[execution-service] server error: %v", err)
	}
}
