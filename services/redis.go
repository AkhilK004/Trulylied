package services

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/trulylied/backend/config"
)

var redisClient *redis.Client

// InitRedis creates the Redis client.
func InitRedis() {
	redisClient = redis.NewClient(&redis.Options{
		Addr:         config.App.RedisURL,
		Password:     "", // set if your ElastiCache has auth enabled
		DB:           0,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	// Verify connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Printf("[redis] WARNING: Could not connect to Redis at %s: %v", config.App.RedisURL, err)
		log.Println("[redis] Continuing without cache — fact-check results will NOT be cached")
		return
	}
	log.Printf("[redis] Connected to Redis at %s", config.App.RedisURL)
}

// RedisGet retrieves a cached string value. Returns "" on miss or error.
func RedisGet(key string) string {
	if redisClient == nil {
		return ""
	}
	val, err := redisClient.Get(context.Background(), key).Result()
	if err != nil {
		return "" // cache miss is not an error we need to surface
	}
	return val
}

// RedisSet stores a value with a TTL. Silently no-ops if Redis is unavailable.
func RedisSet(key, value string, ttl time.Duration) {
	if redisClient == nil {
		return
	}
	if err := redisClient.Set(context.Background(), key, value, ttl).Err(); err != nil {
		log.Printf("[redis] Warning: failed to set key %q: %v", key, err)
	}
}

// RedisIncr atomically increments a counter and returns the new value.
// Used for rate limiting.
func RedisIncr(key string) (int64, error) {
	if redisClient == nil {
		return 0, fmt.Errorf("redis not available")
	}
	return redisClient.Incr(context.Background(), key).Result()
}

// RedisExpire sets an expiry on a key. Used together with RedisIncr for rate limiting.
func RedisExpire(key string, ttl time.Duration) {
	if redisClient == nil {
		return
	}
	redisClient.Expire(context.Background(), key, ttl)
}
