CREATE DATABASE IF NOT EXISTS game_analytics;

CREATE TABLE IF NOT EXISTS game_analytics.game_events
(
    event_id String,
    event_type LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC'),
    game_id LowCardinality(String),
    player_id String,
    session_id String,
    platform LowCardinality(String),
    app_version String,
    country LowCardinality(String),
    properties String,
    level UInt32 MATERIALIZED JSONExtractUInt(properties, 'level'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (game_id, player_id, event_type, received_at, event_id)
TTL toDateTime(received_at) + INTERVAL 180 DAY DELETE;
