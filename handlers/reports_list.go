package handlers

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/trulylied/backend/services"
)

// ListReports handles GET /api/reports
// Returns all reports sorted by created_at descending for the history page.
func ListReports(c *gin.Context) {
	reports, err := services.ListAllReports()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch reports"})
		return
	}

	// Sort by created_at descending (newest first)
	sort.Slice(reports, func(i, j int) bool {
		return reports[i].CreatedAt > reports[j].CreatedAt
	})

	c.JSON(http.StatusOK, gin.H{"reports": reports})
}
