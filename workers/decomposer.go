package workers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type DecomposedClaims struct {
	FactualClaims []string `json:"factual_claims"`
	Opinions      []string `json:"opinions"`
	ToxicPassages []string `json:"toxic_passages"`
}

// DecomposeClaims calls the Python AI microservice to handle the 
// HuggingFace LLM prompting, regex JSON extraction, and fallback logic.
func DecomposeClaims(text string) (*DecomposedClaims, error) {
	payload, _ := json.Marshal(map[string]string{"text": text})
	
	// Decomposition takes longer since it calls HF Inference API
	client := &http.Client{Timeout: 90 * time.Second} 
	resp, err := client.Post(pythonServiceURL+"/decompose", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to call python AI service: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("python service error: %s", string(body))
	}

	var result DecomposedClaims
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse python response: %w", err)
	}

	return &result, nil
}
