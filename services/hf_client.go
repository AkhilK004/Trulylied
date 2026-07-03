package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/trulylied/backend/config"
)

const hfBaseURL = "https://api-inference.huggingface.co/models/"

// Default model — Mistral 7B Instruct is open-access (no license gate).
// Switch to "meta-llama/Meta-Llama-3-8B-Instruct" after accepting the HF license.
const DefaultLLMModel = "mistralai/Mistral-7B-Instruct-v0.3"

// hfRequest is the payload sent to the HuggingFace Inference API.
type hfRequest struct {
	Inputs     string         `json:"inputs"`
	Parameters map[string]any `json:"parameters"`
}

// hfResponse is one item from the response array.
type hfResponse struct {
	GeneratedText string `json:"generated_text"`
}

// CallLLM sends a prompt to the specified HuggingFace model and returns the
// raw generated text. It handles:
//   - Cold-start 503s (model loading) — retries up to 3 times with backoff
//   - Rate-limit 429s — waits and retries
//   - Malformed responses — returns a descriptive error
func CallLLM(model, prompt string) (string, error) {
	payload := hfRequest{
		Inputs: prompt,
		Parameters: map[string]any{
			"max_new_tokens":  1024,
			"return_full_text": false,  // Only return the completion, not the prompt
			"temperature":     0.1,     // Low temperature = more deterministic JSON output
			"do_sample":       true,
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal HF request: %w", err)
	}

	url := hfBaseURL + model

	// Retry loop — handles cold-start (503) and rate-limit (429)
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		result, retry, err := doHFRequest(url, data)
		if err == nil {
			return result, nil
		}
		if !retry || attempt == maxRetries {
			return "", err
		}
		waitTime := time.Duration(attempt*20) * time.Second
		log.Printf("[hf_client] Model not ready (attempt %d/%d), waiting %s: %v", attempt, maxRetries, waitTime, err)
		time.Sleep(waitTime)
	}

	return "", fmt.Errorf("HF API failed after %d attempts", maxRetries)
}

// doHFRequest performs one HTTP call. Returns (result, shouldRetry, error).
func doHFRequest(url string, body []byte) (string, bool, error) {
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		return "", false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+config.App.HFToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-wait-for-model", "true") // Ask HF to wait for cold model instead of 503-ing

	client := &http.Client{Timeout: 120 * time.Second} // LLMs are slow on free tier
	resp, err := client.Do(req)
	if err != nil {
		return "", true, fmt.Errorf("HTTP request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", false, fmt.Errorf("read response: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		// Success — parse the generated text
		var results []hfResponse
		if err := json.Unmarshal(respBody, &results); err != nil {
			// Some models return a single object instead of array
			var single hfResponse
			if err2 := json.Unmarshal(respBody, &single); err2 != nil {
				return "", false, fmt.Errorf("parse HF response: %w — body: %s", err, string(respBody[:min(200, len(respBody))]))
			}
			return single.GeneratedText, false, nil
		}
		if len(results) == 0 || results[0].GeneratedText == "" {
			return "", false, fmt.Errorf("HF returned empty generated text")
		}
		return results[0].GeneratedText, false, nil

	case http.StatusServiceUnavailable:
		// Model is loading (cold start) — safe to retry
		return "", true, fmt.Errorf("model loading (503): %s", string(respBody[:min(100, len(respBody))]))

	case http.StatusTooManyRequests:
		// Rate limited — retry after a wait
		return "", true, fmt.Errorf("rate limited (429)")

	case http.StatusUnauthorized:
		return "", false, fmt.Errorf("invalid HF token (401) — check HF_TOKEN in .env")

	case http.StatusForbidden:
		return "", false, fmt.Errorf("model access denied (403) — you may need to accept the model license on huggingface.co")

	default:
		return "", false, fmt.Errorf("unexpected HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody[:min(200, len(respBody))])))
	}
}

// FormatMistralPrompt wraps a user message in Mistral's [INST] chat format.
// Use this for Mistral-7B-Instruct models.
func FormatMistralPrompt(systemMsg, userMsg string) string {
	if systemMsg != "" {
		return fmt.Sprintf("<s>[INST] %s\n\n%s [/INST]", systemMsg, userMsg)
	}
	return fmt.Sprintf("<s>[INST] %s [/INST]", userMsg)
}

// FormatLlamaPrompt wraps a user message in Llama-3's header chat format.
// Use this for Meta-Llama-3 models.
func FormatLlamaPrompt(systemMsg, userMsg string) string {
	return fmt.Sprintf(
		"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n%s<|eot_id|>"+
			"<|start_header_id|>user<|end_header_id|>\n%s<|eot_id|>"+
			"<|start_header_id|>assistant<|end_header_id|>\n",
		systemMsg, userMsg,
	)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
