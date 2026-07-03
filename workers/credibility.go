package workers

import "strings"

// domainReputation maps known domains to a credibility tier.
// Scores: high=1.0, medium=0.5, low=0.1
// Unknown domains get a default score of 0.5 (medium).
var domainReputation = map[string]float64{
	// ── High Credibility (peer-reviewed, major wire services) ──────────────
	"reuters.com":        1.0,
	"apnews.com":         1.0,
	"bbc.com":            1.0,
	"bbc.co.uk":          1.0,
	"nature.com":         1.0,
	"science.org":        1.0,
	"who.int":            1.0,
	"cdc.gov":            1.0,
	"nih.gov":            1.0,
	"nasa.gov":           1.0,
	"wikipedia.org":      0.9,
	"nytimes.com":        0.9,
	"theguardian.com":    0.9,
	"washingtonpost.com": 0.9,
	"economist.com":      0.9,
	"ft.com":             0.9,
	"bloomberg.com":      0.9,
	"politifact.com":     0.95,
	"snopes.com":         0.95,
	"factcheck.org":      0.95,

	// ── Medium Credibility ──────────────────────────────────────────────────
	"cnn.com":     0.65,
	"foxnews.com": 0.55,
	"nbcnews.com": 0.70,
	"cbsnews.com": 0.70,
	"abcnews.go.com": 0.70,
	"usatoday.com":   0.65,
	"npr.org":        0.80,
	"pbs.org":        0.80,
	"vice.com":       0.55,
	"buzzfeed.com":   0.55,

	// ── Low Credibility (known satire, tabloid, or bias sites) ─────────────
	"theonion.com":           0.05,
	"babylonbee.com":         0.05,
	"worldnewsdailyreport.com": 0.05,
	"nationalreport.net":     0.05,
	"empirenews.net":         0.05,
	"infowars.com":           0.10,
	"breitbart.com":          0.20,
	"dailywire.com":          0.25,
	"dailykos.com":           0.25,
	"example.com":            0.5, // test domain
}

// ScoreDomain returns a credibility score [0.0, 1.0] and a tier label for a domain.
func ScoreDomain(domain string) (score float64, tier string) {
	domain = strings.ToLower(strings.TrimPrefix(domain, "www."))

	if s, ok := domainReputation[domain]; ok {
		return s, tierLabel(s)
	}

	// Default: medium credibility for unknown domains
	return 0.5, "medium"
}

func tierLabel(score float64) string {
	switch {
	case score >= 0.85:
		return "high"
	case score >= 0.45:
		return "medium"
	default:
		return "low"
	}
}
