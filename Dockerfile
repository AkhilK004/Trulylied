# Build Stage
FROM golang:1.22-alpine AS builder

# Install build dependencies for go-sqlite3 (requires CGO)
RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application with CGO enabled (required for sqlite3)
RUN CGO_ENABLED=1 GOOS=linux go build -o main .

# Final Stage
FROM alpine:latest

# Install tzdata and ca-certificates
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/main .

# Expose port
EXPOSE 8080

# Run the Go server
CMD ["./main"]
