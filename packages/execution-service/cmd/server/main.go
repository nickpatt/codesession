// Command server is the entrypoint for the CodeSession execution-service.
//
// Phase 2 scaffold: this currently exposes only a health endpoint so the
// service can be built, deployed, and wired into the session-server ahead of
// the real sandbox implementation.
package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	addr := ":" + envOr("PORT", "9090")

	mux := http.NewServeMux()
	// Liveness probe, mirroring the session-server's /health.
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"service":"execution-service"}`))
	})

	// TODO(phase2): POST /run — accept {code, sessionId}, launch a sandboxed
	// container from the warm pool, and stream stdout/stderr back to the caller.

	log.Printf("[execution-service] listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[execution-service] server error: %v", err)
	}
}

// envOr returns the environment variable value or a fallback default.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
