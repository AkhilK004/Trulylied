package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/trulylied/backend/services"
)

// GetReport handles GET /api/report/:id
// Returns the full report document including final scores once status is "done".
func GetReport(c *gin.Context) {
	reportID := c.Param("id")
	if reportID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "report_id is required"})
		return
	}

	report, err := services.GetReport(reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch report"})
		return
	}
	if report == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}

	// If the report is done, also include all chunks for a full view
	var chunks interface{}
	if report.Status == "done" || report.Status == "failed" {
		ch, err := services.GetChunksByReport(reportID)
		if err == nil {
			chunks = ch
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"report": report,
		"chunks": chunks,
	})
}
