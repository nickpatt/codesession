// Package httpapi exposes the execution-service over HTTP: a streaming /run
// endpoint and a /stop endpoint. The session-server is the only intended
// caller; it fans the streamed output out to browser clients over WebSockets.
package httpapi

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/nickpatt/codesession/execution-service/internal/run"
)

// Server holds the dependencies the HTTP handlers need.
type Server struct {
	manager *run.Manager
}

// New builds the HTTP handler set.
func New(manager *run.Manager) *Server {
	return &Server{manager: manager}
}

// Routes returns the configured mux.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /run", s.handleRun)
	mux.HandleFunc("POST /stop", s.handleStop)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "execution-service"})
}

// handleRun executes code and streams the output back as newline-delimited JSON
// (NDJSON): one run.Event per line, flushed as it is produced. The stream ends
// with an "exit" (or "error") event.
func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	var req run.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.SessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sessionId required"})
		return
	}

	events, err := s.manager.Start(req.SessionID, req.Code)
	if err != nil {
		// A run is already active for this session.
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}

	// Stream: we need the ability to flush after each line so output is live.
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)

	enc := json.NewEncoder(w)
	for ev := range events {
		if err := enc.Encode(ev); err != nil {
			// Client (session-server) went away; cancel the run to free the box.
			s.manager.Stop(req.SessionID)
			return
		}
		flusher.Flush()
	}
}

// handleStop cancels the active run for a session.
func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sessionId required"})
		return
	}
	stopped := s.manager.Stop(req.SessionID)
	writeJSON(w, http.StatusOK, map[string]bool{"stopped": stopped})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("[httpapi] write error: %v", err)
	}
}
