# Final Stage
FROM alpine:latest

# Install tzdata and ca-certificates
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Copy the pre-compiled binary
COPY main-linux ./main
RUN chmod +x ./main

# Expose port
EXPOSE 8080

# Run the Go server
CMD ["./main"]
