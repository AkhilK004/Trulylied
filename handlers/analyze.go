package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/trulylied/backend/models"
	"github.com/trulylied/backend/pipeline"
	"github.com/trulylied/backend/services"
	"github.com/trulylied/backend/workers"
)

type analyzeRequest struct {
	URL string `json:"url" binding:"required,url"`
}

// Analyze handles POST /api/analyze
// It validates the URL, creates a report in DynamoDB, kicks off the background
// pipeline, and returns the report_id immediately so the frontend can subscribe
// to the WebSocket without waiting.
func Analyze(c *gin.Context) {
	var req analyzeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid request body",
			"detail":  err.Error(),
			"example": gin.H{"url": "https://example.com/news-article"},
		})
		return
	}

	reportID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)

	report := models.Report{
		ReportID:    reportID,
		URL:         req.URL,
		Domain:      workers.ExtractDomain(req.URL),
		Status:      "queued",
		ContentType: detectContentType(req.URL),
		CreatedAt:   now,
	}

	if err := services.SaveReport(report); err != nil {
		log.Printf("[analyze] Failed to save report %s: %v", reportID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create report"})
		return
	}

	// Fire and forget — the pipeline runs entirely in the background.
	// The frontend tracks progress via WebSocket /ws/report/:id
	go pipeline.Run(report)

	log.Printf("[analyze] Report %s queued for URL: %s", reportID, req.URL)

	c.JSON(http.StatusAccepted, gin.H{
		"report_id":   reportID,
		"status":      "queued",
		"ws_url":      "/ws/report/" + reportID,
		"report_url":  "/api/report/" + reportID,
		"content_type": report.ContentType,
	})
}

func detectContentType(rawURL string) string {
	if workers.IsYouTubeURL(rawURL) {
		return "youtube"
	}
	return "blog"
}
