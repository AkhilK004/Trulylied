package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type ToxicityResult struct {
	IsToxic bool    `json:"is_toxic"`
	Score   float64 `json:"score"`
	Label   string  `json:"label"` // toxic | non_toxic
}

// AnalyzeToxicity calls the Python microservice to compute a toxicity score
// using unitary/toxic-bert. Returns a score from 0.0 (clean) to 1.0 (very toxic).
func AnalyzeToxicity(text string) (*ToxicityResult, error) {
	payload, _ := json.Marshal(map[string]string{"text": text})

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Post(pythonServiceURL+"/toxicity", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python toxicity service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python toxicity error: %s", string(body))
	}

	var result ToxicityResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse toxicity response: %w", err)
	}
	return &result, nil
}
