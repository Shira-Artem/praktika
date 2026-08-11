# Game Analytics Pipeline

Контейнеризированный backend-pipeline для приема, обработки и хранения игровых событий в реальном времени.

```
Event API (FastAPI)
    ↓ POST /events
Redpanda (Kafka broker)
    ↓ Topic: game-events
Event Processor
    ↓ Batch insert
ClickHouse (OLAP database)
    ↓
Analytics API (FastAPI)
```

## Быстрый старт

### 1. Установка зависимостей

```bash
python -m venv .venv
source .venv/bin/activate  # или .\.venv\Scripts\Activate.ps1 на Windows
pip install -e ".[dev]"
```

### 2. Запуск сервисов

```bash
docker compose up --build
```

После старта доступны:
- **Event API**: http://localhost:8010/docs (Swagger)
- **Analytics API**: http://localhost:8001/docs (Swagger)
- **ClickHouse**: http://localhost:8123

### 3. Отправить тестовое событие

```bash
curl -X POST http://localhost:8010/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "gameplay_win",
    "event_time": "2026-08-11T12:00:00Z",
    "game_id": "arena_escape",
    "player_id": "player_123",
    "session_id": "session_456",
    "platform": "android",
    "app_version": "1.0.0",
    "country": "RU",
    "properties": {
      "level": 4,
      "hearts": 3,
      "coins": 1250
    }
  }'
```

Ответ `202 Accepted` означает, что событие поставлено в очередь.

### 4. Сгенерировать тестовые данные

```bash
docker compose run --rm event-generator
```

Или с другим количеством событий:
```bash
docker compose run --rm -e GENERATOR_TOTAL_EVENTS=5000 event-generator
```

### 5. Смотреть метрики

```bash
curl http://localhost:8001/metrics/summary
curl http://localhost:8001/metrics/event-types
curl http://localhost:8001/metrics/funnel
```

## Структура проекта

```
src/
├── event_api/          # FastAPI сервис приема событий
├── event_processor/    # Консьюмер Redpanda, писатель в ClickHouse
├── analytics_api/      # FastAPI для аналитики
├── event_generator/    # Генератор тестовых событий
└── shared/             # Общие модели и утилиты

docker/
└── clickhouse/         # Инициализация БД

tests/                  # Unit и E2E тесты
```

## Особенности

- **Надежная доставка**: Offset коммитится только после успешной записи в ClickHouse
- **Авторетрай**: Экспоненциальный backoff при ошибках (0.5s → 30s)
- **Валидация**: Клиентские timestamps проверяются на здравомыслие
- **ULID event_id**: Автогенерация уникальных ID если не передано

## Тесты

```bash
# Unit тесты
pytest

# E2E тест (поднимает свои контейнеры)
RUN_E2E=1 pytest -m e2e tests/e2e/test_pipeline_e2e.py -vv
```

## Детальная документация

- [docs/explained.md](docs/explained.md) — как устроено, решения, вопросы
- [docs/technical_plan.md](docs/technical_plan.md) — архитектура и планы
