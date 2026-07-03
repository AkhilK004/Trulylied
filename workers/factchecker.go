package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type FactCheckResult struct {
	Verdict     string   `json:"verdict"`
	Confidence  float64  `json:"confidence"`
	DateContext string   `json:"date_context"`
	Citations   []string `json:"citations"`
	Reasoning   string   `json:"reasoning"`
}

// FactCheck calls the Python AI microservice to handle the Serper Google Search
// and the Self-Corrective RAG loop to generate a final fact-checking verdict.
func FactCheck(claim string, fastMode bool) (*FactCheckResult, error) {
	payload, _ := json.Marshal(map[string]any{"claim": claim, "fast_mode": fastMode})
	
	// Fact-checking can take a while (multiple searches + multiple LLM calls)
	client := &http.Client{Timeout: 180 * time.Second} 
	resp, err := client.Post(pythonServiceURL+"/factcheck", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python AI service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python service error: %s", string(body))
	}

	var result FactCheckResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse python response: %w", err)
	}

	// Ensure citations is never nil for cleaner JSON responses
	if result.Citations == nil {
		result.Citations = []string{}
	}

	return &result, nil
}
