package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/trulylied/backend/services"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins for now — restrict to your frontend domain in production
	CheckOrigin: func(r *http.Request) bool { return true },
}

// ReportWebSocket handles WS /ws/report/:id
// The frontend connects here immediately after POSTing to /api/analyze.
// As each claim is processed by the pipeline, a ChunkUpdate is sent down the socket.
func ReportWebSocket(c *gin.Context) {
	reportID := c.Param("id")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[ws] Upgrade failed for report %s: %v", reportID, err)
		return
	}
	defer conn.Close()

	// If the report already exists and is done, tell the client immediately
	report, _ := services.GetReport(reportID)
	if report != nil && (report.Status == "done" || report.Status == "failed") {
		sendJSON(conn, map[string]string{"status": report.Status})
		return
	}

	// Register a channel that the pipeline will push updates into
	updateCh := services.RegisterWSChannel(reportID)
	defer services.UnregisterWSChannel(reportID)

	log.Printf("[ws] Client connected for report %s", reportID)

	for update := range updateCh {
		if err := sendJSON(conn, update); err != nil {
			log.Printf("[ws] Write error for report %s: %v", reportID, err)
			break
		}
		// Stop streaming once the report is fully done or failed
		if update.Status == "report_done" || update.Status == "error" {
			break
		}
	}

	log.Printf("[ws] Client disconnected for report %s", reportID)
}

func sendJSON(conn *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, data)
}
