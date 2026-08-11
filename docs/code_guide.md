# Методичка по коду: где что лежит и как работает

Эта методичка — **карта кода**. Она отвечает на вопрос «где это написано и что делает».
Если хочешь понять *почему* приняты те или иные решения (очередь, at-least-once, ClickHouse) —
читай [explained.md](explained.md). Здесь — про сами файлы.

Читать можно сверху вниз один раз, а потом возвращаться к нужному разделу.

Оглавление:

1. [Общая карта репозитория](#1-общая-карта-репозитория)
2. [Три слоя кода](#2-три-слоя-кода)
3. [`shared/` — общий контракт (ядро проекта)](#3-shared--общий-контракт-ядро-проекта)
4. [`event_api/` — приём событий](#4-event_api--приём-событий)
5. [`event_processor/` — обработка и запись в базу](#5-event_processor--обработка-и-запись-в-базу)
6. [`analytics_api/` — витрина и дашборд](#6-analytics_api--витрина-и-дашборд)
7. [`event_generator/` — генератор нагрузки](#7-event_generator--генератор-нагрузки)
8. [Инфраструктура: Docker, compose, SQL](#8-инфраструктура-docker-compose-sql)
9. [Как настройки попадают в код (паттерн Settings)](#9-как-настройки-попадают-в-код-паттерн-settings)
10. [`tests/` — что проверяется](#10-tests--что-проверяется)
11. [Шпаргалка «хочу изменить X — куда смотреть»](#11-шпаргалка-хочу-изменить-x--куда-смотреть)

---

## 1. Общая карта репозитория

```text
Praktika/
├── docker-compose.yml        # описание всей системы: какие контейнеры и как связаны
├── Dockerfile                # рецепт ОДНОГО образа, из которого работают 4 Python-сервиса
├── pyproject.toml            # зависимости проекта и настройки (что ставить, как паковать)
├── .env.example              # пример переменных окружения
│
├── src/                      # ВЕСЬ Python-код здесь
│   ├── shared/               # общий код для всех сервисов (модель события, ULID, логи)
│   ├── event_api/            # сервис №1: приём событий по HTTP
│   ├── event_processor/      # сервис №2: чтение очереди → запись в ClickHouse
│   ├── analytics_api/        # сервис №3: метрики + дашборд
│   └── event_generator/      # сервис №4: генератор тестовых событий
│
├── db/ (docker/clickhouse/init/)   # SQL, который создаёт таблицу при первом старте базы
│   └── 001_create_game_events.sql
│
├── tests/                    # автотесты (pytest)
│
└── docs/                     # документация (эта методичка, explained.md, technical_plan.md)
```

Главное, что надо усвоить сразу: **весь код лежит в `src/`**, и он разбит на 5 папок-пакетов.
Четыре из них — это сервисы (отдельные программы), пятая (`shared`) — общий код, который
используют все.

---

## 2. Три слоя кода

Мысленно раздели проект на три слоя — так проще не запутаться:

| Слой | Папки | Роль |
| --- | --- | --- |
| **Общий контракт** | `src/shared/` | одна модель события на всех, генератор ULID, логи |
| **Сервисы** | `src/event_api/`, `src/event_processor/`, `src/analytics_api/`, `src/event_generator/` | 4 отдельные программы |
| **Инфраструктура** | `Dockerfile`, `docker-compose.yml`, `db/`, `pyproject.toml` | как это собирается и запускается |

Каждый сервис устроен по одному шаблону: `main.py` (точка входа) + `settings.py` (настройки) +
файлы с логикой. Узнаёшь шаблон в одном сервисе — понимаешь все.

---

## 3. `shared/` — общий контракт (ядро проекта)

Папка [src/shared/](../src/shared/). Это **сердце проекта**. Здесь описано, как выглядит
событие, и этим описанием пользуются ВСЕ сервисы. Одна правда на всех — не надо дублировать
модель в каждом сервисе.

### `shared/models.py` — модель события

Файл [models.py](../src/shared/models.py). Самый важный файл во всём проекте.

**Две модели (класса) события:**

- `GameEventIn` (строка 22) — то, что присылает клиент/игра. Что здесь важно:
  - `model_config = ConfigDict(extra="forbid", ...)` — **запрещены лишние поля**. Пришлёшь
    незнакомое поле → ошибка. Это защита от опечаток.
  - обязательные поля: `event_type`, `event_time`, `game_id`, `player_id`, `session_id`.
  - необязательные: `event_id`, `platform`, `app_version`, `country`, `properties`.
  - валидаторы (`@field_validator`): время должно быть с таймзоной, `country` — 2 буквы,
    `properties` — не больше 16 КБ и должно сериализоваться в JSON.

- `EnrichedGameEvent` (строка 64) — «обогащённое» событие, которое уже гуляет по системе.
  Наследует `GameEventIn` и **добавляет** обязательный `event_id` и служебное `received_at`
  (время получения сервером).

**Три функции-помощника:**

- `validate_event_time()` (строка 74) — проверяет, что `event_time` не в далёком будущем
  (макс. +5 минут) и не слишком старое (макс. 90 дней). Это защита от кривых клиентских часов.
- `normalize_event()` (строка 82) — **главная функция**. Берёт входное событие, проверяет
  время, генерирует `event_id` (ULID), если его нет, проставляет `received_at`, и возвращает
  готовый `EnrichedGameEvent`. Её вызывает `event_api` на каждое событие.
- `serialize_event()` (строка 92) — превращает событие в байты (JSON) для отправки в очередь.

Константы наверху файла (`MAX_PROPERTIES_BYTES`, `MAX_FUTURE_SKEW`, `MAX_PAST_AGE`) — это те
самые лимиты. Хочешь поменять «5 минут» на «10» — правишь здесь.

### `shared/ulid.py` — генератор идентификаторов

Файл [ulid.py](../src/shared/ulid.py). Функция `new_ulid()` создаёт уникальный ID события.
ULID — это 26 символов, где первая часть — время создания, вторая — случайность. Поэтому ULID
сортируется по времени (в отличие от обычного UUID). Используется в `normalize_event()` и в
генераторе.

### `shared/logging.py` — единая настройка логов

Файл [logging.py](../src/shared/logging.py). Одна функция `configure_logging()`, которую
каждый сервис вызывает на старте, чтобы логи выглядели одинаково.

---

## 4. `event_api/` — приём событий

Папка [src/event_api/](../src/event_api/). Это **входная дверь** системы: HTTP-сервис на
FastAPI, куда игра шлёт события. Открывается на `localhost:8010`.

### `event_api/main.py` — эндпоинты

Файл [main.py](../src/event_api/main.py).

- `create_app()` (строка 22) — «фабрика», которая собирает FastAPI-приложение. Такой приём
  (фабрика вместо глобального `app`) удобен для тестов: можно подсунуть фейковый producer.
- `lifespan()` (строка 31) — что делать при старте и остановке сервиса: подключить продюсер
  к очереди при запуске, отключить при выходе.
- `GET /health` (строка 48) — «я жив?».
- `POST /events` (строка 52) — приём **одного** события. Логика по шагам:
  1. FastAPI сам проверяет тело по модели `GameEventIn` (не так → **422**).
  2. `normalize_event()` — проверка времени, генерация ULID, `received_at` (плохое время → **422**).
  3. `producer.send_event()` — отправка в очередь. Брокер недоступен → **503**.
  4. Успех → **202** и `event_id`.
- `POST /events/batch` (строка 73) — приём **пачки**. Проверяет каждое событие; если хоть одно
  плохое — **отклоняет всю пачку** и возвращает список ошибок с индексами (`index`). Этим
  эндпоинтом пользуется генератор.

### `event_api/producer.py` — отправка в очередь

Файл [producer.py](../src/event_api/producer.py).

- `EventProducer` (строка 13) — это `Protocol`, т.е. «интерфейс»: описание, какие методы должен
  иметь любой продюсер (`start`, `stop`, `send_event`, `send_events`). Позволяет подменять
  реализацию.
- `KafkaEventProducer` (строка 27) — настоящий продюсер поверх `aiokafka`. Ключевые настройки:
  - `acks="all"` — ждём подтверждения записи от брокера (не «отправил и забыл»).
  - `key=event.player_id` (строка 56) — ключ сообщения = игрок, чтобы все его события шли
    в одну партицию по порядку.
  - `value_serializer=serialize_event` — как превращать событие в байты (та функция из shared).
- `BrokerUnavailable` (строка 9) — своё исключение: если брокер не подтвердил, оно долетает
  до `main.py` и превращается в **503**.
- `InMemoryEventProducer` (строка 66) — фейковый продюсер «в память», для тестов (никакой
  Kafka не нужен).

> 📌 Честное узкое место: `send_events()` (строка 61) шлёт пачку **по одному событию** в цикле.
> Корректно, но не быстро. Это первое, что стоит ускорить, если будешь мерить throughput.

### `event_api/settings.py` — настройки

Файл [settings.py](../src/event_api/settings.py). Адрес брокера, имя топика, макс. размер
пачки. Подробнее про механизм — раздел 9.

---

## 5. `event_processor/` — обработка и запись в базу

Папка [src/event_processor/](../src/event_processor/). Самый содержательный сервис. У него
**нет HTTP** — это фоновый вечный цикл: читает очередь и пишет в ClickHouse.

### `event_processor/main.py` — главный цикл

Файл [main.py](../src/event_processor/main.py).

- `parse_event_payload()` (строка 18) — разбирает байты из очереди обратно в `EnrichedGameEvent`.
- `run()` (строка 23) — вся жизнь сервиса:
  - создаёт `AIOKafkaConsumer` с **`enable_auto_commit=False`** (строка 38) — коммитим offset
    вручную, это ключ к тому, чтобы не терять события.
  - `auto_offset_reset="earliest"` — если группа новая, читать с самого начала.
  - ставит обработчики сигналов `SIGINT`/`SIGTERM` (строка 44) → при остановке контейнера
    выставляется `stop_event`, и цикл аккуратно завершается (graceful shutdown).
  - **главный цикл** `while not stop_event.is_set()` (строка 57):
    1. `consumer.getmany(timeout_ms=..., max_records=batch_size)` — забрать пачку сообщений
       (до `batch_size` штук **или** пока не истечёт таймаут — что раньше).
    2. распарсить каждое; битые (невалидный JSON/структура) → в лог и **пропустить** (строка 75),
       чтобы не застрять на «ядовитом» сообщении.
    3. `writer.insert_events(events)` — записать пачку в базу.
    4. `consumer.commit()` (строка 99) — **сдвинуть закладку только ПОСЛЕ успешной записи**.

Порядок «сначала запись, потом commit» = гарантия **at-least-once**: если сервис упадёт между
записью и коммитом, пачку перечитают заново (возможен дубль, но не потеря).

### `event_processor/clickhouse.py` — запись с ретраями

Файл [clickhouse.py](../src/event_processor/clickhouse.py).

- `COLUMNS` (строка 14) — список колонок таблицы, в том же порядке, что и значения строки.
- `ClickHouseEventWriter` (строка 33) — умеет вставлять пачки.
  - `insert_events()` (строка 48) — превращает события в строки (`_to_row`) и вставляет.
  - `_insert_with_retry()` (строка 58) — **ретраи с экспоненциальным backoff**: при ошибке
    пауза `0.5 → 1 → 2 → 4 … → 30с (потолок)`, до 8 попыток, перед каждой пересоздаётся
    соединение (`_reconnect`). Пока не записалось — offset не коммитится. `should_stop`
    позволяет прервать ожидание при shutdown.
  - `_to_row()` (строка 127) — превращает событие в список значений; `properties` тут
    сериализуется в JSON-строку (в базе это колонка `String`).

### `event_processor/settings.py`

Файл [settings.py](../src/event_processor/settings.py). Адрес брокера и базы, `batch_size`,
`batch_flush_interval_seconds` (те самые «500 событий или 2 секунды»), и параметры ретраев.

---

## 6. `analytics_api/` — витрина и дашборд

Папка [src/analytics_api/](../src/analytics_api/). Читает данные из ClickHouse и отдаёт их —
в виде JSON (для машин) и в виде красивого дашборда (для людей). Открывается на `localhost:8001`.

### `analytics_api/main.py` — эндпоинты и дашборд

Файл [main.py](../src/analytics_api/main.py).

- `GET /` — отдаёт **дашборд** (HTML-страницу).
- `GET /health` — «я жив?».
- `GET /metrics/summary` — общие цифры (всего событий, игроков, сессий).
- `GET /metrics/event-types` — сколько каких событий.
- `GET /metrics/recent-events` — последние N событий.
- `GET /metrics/funnel` — воронка (по умолчанию `gameplay_start → gameplay_win`).

### `analytics_api/clickhouse.py` — SQL-запросы

Файл [clickhouse.py](../src/analytics_api/clickhouse.py). Класс `AnalyticsReader` — здесь живут
все SQL-запросы к базе. Хочешь новую метрику — добавляешь метод сюда и эндпоинт в `main.py`.
Есть защита `validate_event_types()` — чтобы в SQL нельзя было подсунуть что попало.

### `analytics_api/static/dashboard.html` — сам дашборд

Файл [dashboard.html](../src/analytics_api/static/dashboard.html). Одна самодостаточная
страница (HTML + CSS + JS, без внешних библиотек). Она по таймеру дёргает `/metrics/*`
и рисует карточки, полоски и таблицу. В compose этот файл подцеплен как volume — правки
видны после обновления страницы, **без пересборки образа**.

---

## 7. `event_generator/` — генератор нагрузки

Папка [src/event_generator/](../src/event_generator/). Притворяется игрой и шлёт события
в `event_api`. Запускается разово: `docker compose run --rm event-generator`.

- [generator.py](../src/event_generator/generator.py) — **придумывает** события. Наверху список
  `EVENT_TYPES` — каталог событий преподавателя (с весами: геймплей часто, покупки редко).
  `generate_event()` собирает одно событие, `_properties_for()` задаёт `properties` под каждый тип.
- [main.py](../src/event_generator/main.py) — **отправляет**. Цикл `run()` шлёт события батчами
  на `/events/batch` с ретраями.
- [settings.py](../src/event_generator/settings.py) — сколько событий, размер батча, сколько
  игроков (`GENERATOR_TOTAL_EVENTS`, `GENERATOR_BATCH_SIZE`, `GENERATOR_PLAYERS`).

> ⚠️ После правок кода генератора нужен `docker compose build event-generator` — у него
> `profiles: ["tools"]`, поэтому обычный `up --build` его пропускает.

---

## 8. Инфраструктура: Docker, compose, SQL

### `Dockerfile`

Файл [Dockerfile](../Dockerfile). Рецепт **одного** образа: берём Python 3.12, копируем код,
`pip install .`. Из этого одного образа работают **четыре** сервиса — отличаются только командой
запуска (`command:` в compose). Это норма для монорепозитория: код общий, точки входа разные.

### `docker-compose.yml`

Файл [docker-compose.yml](../docker-compose.yml). Описание всей системы: 5 постоянных сервисов +
`redpanda-init` (разовый, создаёт топик с 6 партициями) + `event-generator` (под профилем
`tools`). Здесь же — healthcheck'и, `depends_on` (кто кого ждёт), проброс портов, volume для базы
и для дашборда, и все переменные окружения.

### `db/clickhouse/init/001_create_game_events.sql`

Файл [001_create_game_events.sql](../docker/clickhouse/init/001_create_game_events.sql). SQL,
который ClickHouse выполняет **один раз при создании тома**: создаёт базу `game_analytics` и
таблицу `game_events`. Здесь описаны колонки, движок `MergeTree`, партиционирование, ключ
сортировки, materialized-колонка `level` и TTL. Поменял схему → нужен `docker compose down -v`,
чтобы SQL применился заново (данные при этом удалятся).

### `pyproject.toml`

Файл [pyproject.toml](../pyproject.toml). Список зависимостей (`fastapi`, `aiokafka`,
`clickhouse-connect`, `pydantic` …), настройки упаковки (`package-data` — чтобы HTML дашборда
попал в образ) и настройки тестов.

---

## 9. Как настройки попадают в код (паттерн Settings)

В каждом сервисе есть `settings.py` с классом `Settings(BaseSettings)`. Это одинаковый приём,
и его важно понять один раз.

- У класса есть `env_prefix` (например, `PROCESSOR_`, `EVENT_API_`, `ANALYTICS_`, `GENERATOR_`).
- Каждое поле класса можно задать переменной окружения: поле `clickhouse_host` при префиксе
  `PROCESSOR_` управляется переменной `PROCESSOR_CLICKHOUSE_HOST`.
- Значения этих переменных задаются в `docker-compose.yml` (блок `environment:`) или через
  `-e ПЕРЕМЕННАЯ=значение` в команде.

Отсюда простое правило: **в коде адресов и паролей нет** — только имена полей и значения
по умолчанию. Реальные адреса приходят снаружи. Это принцип «12-factor app»: один образ,
поведение меняется переменными.

Пример связи: `event-processor` в compose получает `PROCESSOR_CLICKHOUSE_HOST: clickhouse`.
Внутри Python это поле `clickhouse_host = "clickhouse"`. Дальше `clickhouse.py` подключается
к хосту `clickhouse` (имя контейнера в docker-сети).

---

## 10. `tests/` — что проверяется

Папка [tests/](../tests/). Автотесты на `pytest`. Запуск: `pytest` (или через venv:
`.venv/Scripts/python.exe -m pytest`).

- `test_shared_models.py` — модель события: валидное/невалидное, кривое время, большие `properties`.
- `test_event_api.py` — эндпоинты приёма (202/422/503) с фейковым продюсером.
- `test_event_processor.py` — ретраи и backoff записи в ClickHouse, что offset не коммитится
  при ошибке.
- `test_analytics_api.py` — метрики.
- `test_event_generator.py` — что генератор выдаёт события по контракту.
- `tests/e2e/test_pipeline_e2e.py` — сквозной тест через реальные Redpanda + ClickHouse
  (запускается отдельно, с `RUN_E2E=1`).

Тесты используют фейковые реализации (`InMemoryEventProducer`) там, где не нужна настоящая
инфраструктура — поэтому быстрые unit-тесты проходят без Docker.

---

## 11. Шпаргалка «хочу изменить X — куда смотреть»

| Хочу... | Файл |
| --- | --- |
| Добавить/изменить поле события | [shared/models.py](../src/shared/models.py) |
| Поменять лимит времени/размера properties | [shared/models.py](../src/shared/models.py) (константы наверху) |
| Изменить логику приёма или статусы ответа | [event_api/main.py](../src/event_api/main.py) |
| Настроить продюсер (acks, ключ) | [event_api/producer.py](../src/event_api/producer.py) |
| Поменять размер батча / интервал записи | [event_processor/settings.py](../src/event_processor/settings.py) |
| Изменить логику записи/ретраев | [event_processor/clickhouse.py](../src/event_processor/clickhouse.py) |
| Добавить новую метрику/эндпоинт аналитики | [analytics_api/clickhouse.py](../src/analytics_api/clickhouse.py) + [analytics_api/main.py](../src/analytics_api/main.py) |
| Поменять внешний вид дашборда | [analytics_api/static/dashboard.html](../src/analytics_api/static/dashboard.html) |
| Изменить типы генерируемых событий | [event_generator/generator.py](../src/event_generator/generator.py) |
| Поменять схему таблицы в базе | [db init SQL](../docker/clickhouse/init/001_create_game_events.sql) (+ `down -v`) |
| Изменить адреса/порты/переменные сервисов | [docker-compose.yml](../docker-compose.yml) |
| Добавить зависимость (библиотеку) | [pyproject.toml](../pyproject.toml) |

---

## Куда дальше

- Идеи и «почему так» + вопросы на защите → [explained.md](explained.md).
- Полный технический план и расширения → [technical_plan.md](technical_plan.md).
- Как запускать и смотреть → [README](../README.md).
