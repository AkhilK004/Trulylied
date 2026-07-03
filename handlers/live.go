package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/trulylied/backend/models"
	"github.com/trulylied/backend/pipeline"
	"github.com/trulylied/backend/services"
)

// AnalyzeLive handles POST /api/analyze-live
// Starts a live video fact-check pipeline that extracts timestamped transcript
// segments and fact-checks each one, streaming results via WebSocket.
func AnalyzeLive(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL is required"})
		return
	}

	reportID := uuid.NewString()
	report := models.Report{
		ReportID:  reportID,
		URL:       req.URL,
		Status:    "queued",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	services.SaveReport(report)

	go pipeline.RunLive(report)

	c.JSON(http.StatusAccepted, gin.H{
		"report_id": reportID,
		"status":    "queued",
		"message":   "Live video analysis started. Connect via WebSocket to receive real-time results.",
	})
}
