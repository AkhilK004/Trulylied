package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	HFToken            string
	SerperAPIKey       string
	AWSRegion          string
	AWSAccessKeyID     string
	AWSSecretAccessKey string
	DynamoReportsTable string
	DynamoChunksTable  string
	RedisURL           string
	Port               string
}

var App Config

// Load reads the .env file and populates the global App config.
// Call this once at startup in main.go.
func Load() {
	// Load .env — ignore error in prod (env vars set externally on AWS)
	if err := godotenv.Load(); err != nil {
		log.Println("[config] No .env file found, reading from environment")
	}

	App = Config{
		HFToken:            getOrDefault("HF_TOKEN", ""),
		SerperAPIKey:       getOrDefault("SERPER_API_KEY", ""),
		AWSRegion:          getOrDefault("AWS_REGION", "us-east-1"),
		AWSAccessKeyID:     os.Getenv("AWS_ACCESS_KEY_ID"),
		AWSSecretAccessKey: os.Getenv("AWS_SECRET_ACCESS_KEY"),
		DynamoReportsTable: getOrDefault("DYNAMO_REPORTS_TABLE", "trulylied-reports"),
		DynamoChunksTable:  getOrDefault("DYNAMO_CHUNKS_TABLE", "trulylied-chunks"),
		RedisURL:           getOrDefault("REDIS_URL", "localhost:6379"),
		Port:               getOrDefault("PORT", "8080"),
	}

	log.Println("[config] Configuration loaded successfully")
}

func mustGet(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("[config] FATAL: required environment variable %q is not set", key)
	}
	return v
}

func getOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
