package handlers

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/trulylied/backend/services"
)

// GetTrending handles GET /api/trends
// Returns the top 20 domains ranked by analysis count, only including done reports.
func GetTrending(c *gin.Context) {
	reports, err := services.ListAllReports()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch reports"})
		return
	}

	type DomainStat struct {
		Domain      string  `json:"domain"`
		Count       int     `json:"count"`
		AvgScore    float64 `json:"avg_score"`
		LatestURL   string  `json:"latest_url"`
		LatestScore float64 `json:"latest_score"`
	}

	domainMap := map[string]*DomainStat{}
	domainScores := map[string][]float64{}

	for _, r := range reports {
		if r.Status != "done" || r.Domain == "" {
			continue
		}
		if _, ok := domainMap[r.Domain]; !ok {
			domainMap[r.Domain] = &DomainStat{Domain: r.Domain, LatestURL: r.URL, LatestScore: r.CredibilityScore}
		}
		domainMap[r.Domain].Count++
		domainMap[r.Domain].LatestURL = r.URL
		domainMap[r.Domain].LatestScore = r.CredibilityScore
		domainScores[r.Domain] = append(domainScores[r.Domain], r.CredibilityScore)
	}

	var stats []DomainStat
	for domain, stat := range domainMap {
		scores := domainScores[domain]
		var total float64
		for _, s := range scores {
			total += s
		}
		stat.AvgScore = total / float64(len(scores))
		stats = append(stats, *stat)
	}

	// Sort by analysis count descending
	sort.Slice(stats, func(i, j int) bool {
		return stats[i].Count > stats[j].Count
	})

	if len(stats) > 20 {
		stats = stats[:20]
	}

	// Also include the 10 most recent full reports
	sort.Slice(reports, func(i, j int) bool {
		return reports[i].CreatedAt > reports[j].CreatedAt
	})
	recent := reports
	if len(recent) > 10 {
		recent = recent[:10]
	}

	c.JSON(http.StatusOK, gin.H{
		"trending_domains": stats,
		"recent_analyses":  recent,
	})
}
