# build
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cost-thinking .

# run
FROM alpine:3.21
RUN adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/cost-thinking /app/cost-thinking
RUN mkdir -p /app/data && chown -R app:app /app
USER app
ENV PORT=8096 DB_PATH=/app/data/board.db
EXPOSE 8096
CMD ["/app/cost-thinking"]
