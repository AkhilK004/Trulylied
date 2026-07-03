package services

import (
	"sync"

	"github.com/trulylied/backend/models"
)

// wsRegistry maps report_id → channel for streaming chunk updates to WebSocket handlers.
var (
	wsRegistry   = map[string]chan models.ChunkUpdate{}
	wsRegistryMu sync.RWMutex
)

// RegisterWSChannel creates and stores a buffered channel for a report.
// The pipeline will push updates here; the WebSocket handler reads from it.
func RegisterWSChannel(reportID string) chan models.ChunkUpdate {
	ch := make(chan models.ChunkUpdate, 50) // buffered so pipeline never blocks on WS
	wsRegistryMu.Lock()
	wsRegistry[reportID] = ch
	wsRegistryMu.Unlock()
	return ch
}

// GetWSChannel retrieves an existing channel, or nil if no WS is connected.
func GetWSChannel(reportID string) chan models.ChunkUpdate {
	wsRegistryMu.RLock()
	defer wsRegistryMu.RUnlock()
	return wsRegistry[reportID]
}

// UnregisterWSChannel closes and removes the channel for a report.
func UnregisterWSChannel(reportID string) {
	wsRegistryMu.Lock()
	defer wsRegistryMu.Unlock()
	if ch, ok := wsRegistry[reportID]; ok {
		close(ch)
		delete(wsRegistry, reportID)
	}
}

// PushUpdate sends a ChunkUpdate to the WebSocket channel if one exists.
// Safe to call even if no WebSocket is connected — it just no-ops.
func PushUpdate(reportID string, update models.ChunkUpdate) {
	wsRegistryMu.RLock()
	ch, ok := wsRegistry[reportID]
	wsRegistryMu.RUnlock()
	if ok {
		select {
		case ch <- update:
		default:
			// Channel is full — drop the update rather than block the goroutine
		}
	}
}
