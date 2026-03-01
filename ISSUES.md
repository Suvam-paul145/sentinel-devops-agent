# Sentinel DevOps Agent — Issue Tracker

> **Note:** I, Suvam Paul (@Suvam-paul145), want to work on all of the issues described in this document.

This document contains **10 Hard-Level Issues** and **10 Medium-Level Issues** identified in the Sentinel DevOps Agent repository. Each issue includes a problem description, the reason it is required, and the proposed approach.

---

## Table of Contents

- [Hard-Level Issues](#hard-level-issues)
  - [H-01 · Persistent State Management — Replace In-Memory Database](#h-01--persistent-state-management--replace-in-memory-database)
  - [H-02 · Predictive Failure Detection via ML Anomaly Detection](#h-02--predictive-failure-detection-via-ml-anomaly-detection)
  - [H-03 · Multi-Cluster / Multi-Region Monitoring Support](#h-03--multi-cluster--multi-region-monitoring-support)
  - [H-04 · Distributed Tracing with OpenTelemetry Integration](#h-04--distributed-tracing-with-opentelemetry-integration)
  - [H-05 · End-to-End Test Suite with Chaos Engineering Scenarios](#h-05--end-to-end-test-suite-with-chaos-engineering-scenarios)
  - [H-06 · Secret Management & Vault Integration](#h-06--secret-management--vault-integration)
  - [H-07 · Circuit Breaker Pattern Across Service-to-Service Calls](#h-07--circuit-breaker-pattern-across-service-to-service-calls)
  - [H-08 · Redis Caching Layer for Metrics and Status Data](#h-08--redis-caching-layer-for-metrics-and-status-data)
  - [H-09 · Full HTTPS / TLS Enforcement Across the Entire Stack](#h-09--full-https--tls-enforcement-across-the-entire-stack)
  - [H-10 · Custom Self-Learning Healing Policies Engine](#h-10--custom-self-learning-healing-policies-engine)
- [Medium-Level Issues](#medium-level-issues)
  - [M-01 · Structured Logging System with Log Levels and Rotation](#m-01--structured-logging-system-with-log-levels-and-rotation)
  - [M-02 · Slack / PagerDuty Alert Integration for Incidents](#m-02--slack--pagerduty-alert-integration-for-incidents)
  - [M-03 · Improve RBAC — Fine-Grained Permission Checks on All Routes](#m-03--improve-rbac--fine-grained-permission-checks-on-all-routes)
  - [M-04 · Real SLO Burn-Rate Alerting in the Backend](#m-04--real-slo-burn-rate-alerting-in-the-backend)
  - [M-05 · CLI Output Formatting and Color-Coded JSON Reports](#m-05--cli-output-formatting-and-color-coded-json-reports)
  - [M-06 · Frontend Accessibility (a11y) Audit and Fixes](#m-06--frontend-accessibility-a11y-audit-and-fixes)
  - [M-07 · Docker Health-Check Directives in All Service Dockerfiles](#m-07--docker-health-check-directives-in-all-service-dockerfiles)
  - [M-08 · API Rate Limiter Per-User Scope and Custom Error Messages](#m-08--api-rate-limiter-per-user-scope-and-custom-error-messages)
  - [M-09 · Historical Metrics Retention and Trend Visualization](#m-09--historical-metrics-retention-and-trend-visualization)
  - [M-10 · Backend Refactor — Convert to TypeScript](#m-10--backend-refactor--convert-to-typescript)

---

## Hard-Level Issues

---

### H-01 · Persistent State Management — Replace In-Memory Database

**Labels:** `hard`, `backend`, `architecture`  
**I want to work on this issue.**

#### Problem Description

The entire Sentinel backend (`backend/index.js`) stores all operational data — `systemStatus`, `activityLog`, and `aiLogs` — in plain JavaScript variables (`let systemStatus = {}`, `let activityLog = []`, `let aiLogs = []`). These in-memory arrays are wiped every time the process restarts. As a consequence, all historical incident records, AI analysis results, and activity logs are permanently lost whenever the backend container is restarted, updated, or crashes — which is precisely the scenario that Sentinel is designed to handle for other services.

#### Why It Is Required

A DevOps intelligence platform must have durable state. Without persistence:
- Operators lose full incident history after every deployment or crash.
- The AI analysis engine cannot learn from past events.
- Post-mortem investigations become impossible because there is no historical log.
- The SLO tracker cannot compute rolling windows across restarts.
- The dashboard's "Incident Timeline" shows empty data after any restart.

This is listed in `docs/ROADMAP.md` under known limitations ("In-memory caching (no persistence)") and is identified as essential for the production-ready Phase 2.

#### My Approach

I want to introduce a proper persistence layer by connecting the backend to the PostgreSQL instance already included in `docker-compose.yml`. The approach involves:

1. Creating dedicated database tables (for `incidents`, `activity_logs`, `system_status_snapshots`) in a new migration file under `backend/db/migrations/`.
2. Replacing direct array mutations in `backend/index.js` with calls to a thin repository layer (e.g., `backend/db/repositories/`) that wraps parameterized SQL queries using the existing `backend/db/config.js` connection pool.
3. Implementing a startup hydration step so the in-memory cache is pre-populated from the database on boot, giving low-latency reads while ensuring durability.
4. Adjusting the SLO tracker (`backend/slo/tracker.js`) to read/write through the same repository layer.

```
Workflow Diagram — State Persistence

┌──────────────────────────────────────────────────────────────┐
│                       WRITE PATH                             │
│                                                              │
│   Event (health check / webhook) ──► backend/index.js       │
│                                            │                 │
│                                            ▼                 │
│                              backend/db/repositories/        │
│                              (parameterized SQL INSERT)      │
│                                            │                 │
│                           ┌────────────────┴──────────┐     │
│                           ▼                           ▼     │
│                    In-Memory Cache              PostgreSQL   │
│                     (fast reads)                (durable)   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                       READ PATH                              │
│                                                              │
│   GET /api/activity  ──► In-Memory Cache (hot)              │
│   GET /api/insights  ──► In-Memory Cache (hot)              │
│                                                              │
│   On Startup: DB ──► hydrate ──► In-Memory Cache            │
└──────────────────────────────────────────────────────────────┘
```

---

### H-02 · Predictive Failure Detection via ML Anomaly Detection

**Labels:** `hard`, `ai`, `backend`, `feature`  
**I want to work on this issue.**

#### Problem Description

Sentinel currently operates in a purely reactive mode. It polls each service's `/health` endpoint every 5 seconds and only triggers an AI analysis after a service has already gone down or become degraded. There is no mechanism to detect subtle trends — such as gradually increasing error rates, memory leaks, or rising latency — before they escalate into a full outage. The Kestra flows (`kestra-flows/intelligent-monitor.yaml`) only invoke the LLM once a failure is confirmed.

#### Why It Is Required

Predictive monitoring is the difference between an incident and a near-miss. If Sentinel can spot a pattern — for example, CPU usage climbing 10% every 10 minutes, or the 95th-percentile latency creeping toward SLO thresholds — it can trigger a pre-emptive heal or alert before users are impacted. The roadmap explicitly lists "Predictive Failure Detection via pattern recognition" and "ML-based anomaly detection" as planned features. Without this, Sentinel is a sophisticated reactive tool rather than a true autonomous agent.

#### My Approach

I want to implement a lightweight, in-process statistical anomaly detector that does not require a separate ML service. The approach involves:

1. Extending `backend/docker/monitor.js` to accumulate a rolling time-series window (e.g., last 50 samples) of CPU, memory, and response-time metrics per container.
2. Implementing a Z-score / Exponential Weighted Moving Average (EWMA) algorithm within the backend to flag metrics that deviate significantly from the recent baseline.
3. When an anomaly score crosses a configurable threshold, emitting an early-warning `ANOMALY_DETECTED` WebSocket event to the frontend and logging a predictive alert via `logActivity()`.
4. Feeding the anomaly context into the Groq LLM prompt via `kestra-flows/intelligent-monitor.yaml` as an additional early-warning pathway, alongside confirmed failures.

```
Workflow Diagram — Predictive Detection Pipeline

Time ──►

Metric Samples: [m1, m2, m3, ... m50]
                                  │
                                  ▼
                     Compute Rolling EWMA Baseline
                                  │
                          ┌───────┴────────┐
                          │  Z-score < 2σ  │  ── Normal ──► No action
                          └───────┬────────┘
                                  │ Z-score ≥ 2σ
                                  ▼
                       ANOMALY_DETECTED Event
                      ┌────────────────────────┐
                      │  WebSocket broadcast   │ ──► Dashboard warning
                      │  logActivity('warn')   │
                      │  Feed to Groq prompt   │ ──► Early LLM analysis
                      └────────────────────────┘
```

---

### H-03 · Multi-Cluster / Multi-Region Monitoring Support

**Labels:** `hard`, `architecture`, `feature`  
**I want to work on this issue.**

#### Problem Description

Sentinel is architecturally constrained to monitoring a single set of services running on the same Docker host. The service URLs in `backend/index.js` are hard-coded to `localhost` ports (3001, 3002, 3003), and the Kestra flows in `kestra-flows/` similarly target local endpoints. There is no concept of a "cluster", "region", or remote agent, making it impossible to use Sentinel to monitor services spread across multiple machines, data centers, or cloud regions.

#### Why It Is Required

Production environments almost universally span multiple hosts, availability zones, and regions. A DevOps intelligence platform that can only see one host is of limited value to organizations running distributed systems. The roadmap identifies "Multi-cluster support" and "Multi-region deployment" as Phase 3 and beyond goals. Laying the architectural groundwork now — particularly by making the backend's service registry configurable — is essential before more complex features are built on top of the current rigid structure.

#### My Approach

I want to redesign the service discovery layer so that monitored endpoints are configurable rather than hard-coded:

1. Introduce a `SERVICES_CONFIG` environment variable (or a JSON config file at `backend/services.config.json`) where operators can declare named clusters and their service URLs.
2. Refactor `backend/index.js` to load the service registry dynamically from this config at startup, removing all hard-coded `localhost` references.
3. Add a lightweight "remote agent" mode: a thin Node.js process that can be deployed on a remote host, exposes a `/metrics` endpoint, and forwards health data back to the central Sentinel backend via a shared webhook secret.
4. Update the frontend's `ServiceGrid` and `ServiceCard` components (`sentinel-frontend/components/dashboard/`) to group services by cluster/region when the backend exposes this grouping.

```
Workflow Diagram — Multi-Cluster Architecture

┌────────────────────────────────────────────────────────┐
│               Sentinel Central Backend                 │
│           (backend/index.js — port 4000)               │
│                                                        │
│   Service Registry (from services.config.json)         │
│   ┌──────────────────┬───────────────────────────┐    │
│   │ cluster: prod-us │ cluster: prod-eu           │    │
│   │  auth → :3001    │  auth → 10.0.1.5:3001     │    │
│   │  payment → :3002 │  payment → 10.0.1.5:3002  │    │
│   └────────┬─────────┴──────────┬────────────────┘    │
│            │                    │                      │
│            ▼                    ▼                      │
│      Local polling        Remote Agent poll            │
│   (every 5s)              (agent webhook push)         │
└────────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
  Docker Host (local)       Remote Host / Cloud
  [auth, payment, notif]    [auth, payment, notif]
```

---

### H-04 · Distributed Tracing with OpenTelemetry Integration

**Labels:** `hard`, `observability`, `backend`, `feature`  
**I want to work on this issue.**

#### Problem Description

Sentinel currently has no request tracing. When a failure occurs in the `auth-service`, `payment-service`, or `notification-service`, there is no way to trace a specific failing request through the system — from the initial client call, through the backend's health-check aggregation, to the Kestra orchestration layer and finally to the AI analysis. The `backend/index.js` logs individual service statuses but cannot correlate which specific requests caused a degradation, making deep-dive debugging extremely difficult.

#### Why It Is Required

Distributed tracing is a foundational observability pillar alongside metrics and logs. Without traces, engineers cannot answer questions like: "Which specific API call in the payment-service is causing the 500s?" or "How long does Kestra's healing workflow actually take from trigger to completion?" The roadmap lists "Distributed tracing (OpenTelemetry)" as a future vision item. Implementing it now, before the service count grows, is significantly easier than retrofitting it later.

#### My Approach

I want to instrument the backend and the three mock services with the OpenTelemetry SDK (OTLP exporter) without requiring a paid vendor:

1. Add the OpenTelemetry Node.js auto-instrumentation package to `backend/package.json` and each service's `package.json` (under `services/`).
2. Create an `otel.js` bootstrap file that is required first in each `index.js` via `node -r ./otel.js`, enabling automatic HTTP and Express instrumentation without code changes.
3. Add a Jaeger (or Zipkin) container to `docker-compose.yml` as the local trace collector and UI.
4. Enrich the Kestra webhook handler (`/api/kestra-webhook` in `backend/index.js`) so it reads the W3C `traceparent` header and propagates the trace context, linking the AI healing action back to the original failure trace.

```
Workflow Diagram — Distributed Trace Flow

Client Request
     │
     ▼  [TraceID: abc123, SpanID: 001]
auth-service (services/auth-service/index.js)
     │  [SpanID: 002, parent: 001]
     ▼
Backend Health Check (backend/index.js)
     │  [SpanID: 003, parent: 001]
     ▼
Kestra Webhook (/api/kestra-webhook)
     │  [SpanID: 004, parent: 001]
     ▼
Groq LLM Analysis
     │  [SpanID: 005, parent: 001]
     ▼
Healing Action Complete

All spans exported ──► Jaeger (docker-compose) ──► Trace UI
```

---

### H-05 · End-to-End Test Suite with Chaos Engineering Scenarios

**Labels:** `hard`, `testing`, `quality`  
**I want to work on this issue.**

#### Problem Description

The current test coverage in Sentinel is extremely limited. The CLI has a few unit tests (`cli/tests/heal.test.js`, `cli/tests/status.test.js`, `cli/tests/report.test.js`, `cli/tests/simulate.test.js`) that mock API calls, and the frontend has two component tests (`sentinel-frontend/__tests__/`). The backend has no automated tests at all — only a manual script `backend/test-rbac.js` that must be run by hand. There are no integration tests, no end-to-end tests, and no chaos engineering scenarios that validate the self-healing loop.

#### Why It Is Required

Sentinel's core value proposition — autonomous self-healing — is completely untested by automation. Anyone changing `backend/docker/healer.js`, `backend/docker/monitor.js`, or the Kestra flow YAML files has no safety net. The roadmap explicitly targets "Unit test coverage (80%+)", "Integration tests", "E2E testing", and "Chaos engineering tests" as Phase 2 reliability goals. Without a test suite, every contribution risks silently breaking the healing loop.

#### My Approach

I want to build a layered test strategy that covers the full Sentinel healing cycle:

1. **Backend unit tests:** Use Jest to test individual modules in `backend/docker/healer.js`, `backend/docker/monitor.js`, `backend/slo/calculator.js`, and the RBAC services in `backend/auth/`, with mocked Docker and database clients.
2. **Integration tests:** Start the backend in a test mode against a real PostgreSQL test database (using `docker-compose` in CI) and call the REST endpoints (`/api/status`, `/api/kestra-webhook`, `/api/docker/try-restart/:id`) with assertions on the resulting database state.
3. **Chaos E2E scenarios:** Write a test script that uses the CLI (`cli/index.js`) to simulate a service crash (`sentinel simulate auth down`), then polls the backend until it observes the service returning to healthy, asserting that the full cycle completes within a configured timeout (e.g., 90 seconds).

```
Workflow Diagram — Layered Test Pyramid

          ┌─────────────────────────────────┐
          │       E2E Chaos Tests           │  ← CLI simulate → observe heal
          │   (Full Docker stack, ~90s)     │
          └──────────────┬──────────────────┘
                         │
          ┌──────────────▼──────────────────┐
          │     Integration Tests           │  ← Backend + DB (no mocks)
          │   (API endpoints, DB state)     │
          └──────────────┬──────────────────┘
                         │
          ┌──────────────▼──────────────────┐
          │       Unit Tests                │  ← Mocked Docker / DB
          │ (healer, monitor, calculator)   │
          └─────────────────────────────────┘
```

---

### H-06 · Secret Management & Vault Integration

**Labels:** `hard`, `security`, `infrastructure`  
**I want to work on this issue.**

#### Problem Description

Every secret in Sentinel — the Groq API key, the `JWT_SECRET`, and the PostgreSQL password — is managed through a plain `.env` file that is manually copied from `backend/.env.example`. The `docker-compose.yml` passes these values as environment variables in plain text. There is no rotation policy, no audit trail of secret access, and no mechanism to prevent secrets from leaking into container logs, process dumps, or version control. The README itself warns "⚠️ Security Warning" about the default admin password and the hardcoded JWT secret.

#### Why It Is Required

Plain `.env` files are an anti-pattern for production systems. If a developer accidentally commits `.env`, all secrets are exposed. If an attacker gains read access to a container's environment, they immediately obtain every credential. The roadmap explicitly lists "Secret management (Vault integration)" as a Phase 2 security goal. For a project that positions itself as enterprise-grade DevOps infrastructure, insecure secret handling is a critical blocker.

#### My Approach

I want to integrate HashiCorp Vault (or at minimum, Docker Secrets for the container layer) to provide a proper secrets lifecycle:

1. Add a Vault container to `docker-compose.yml` in development mode and document how to start it in `docs/DEVELOPMENT.md`.
2. Write a small `backend/lib/secrets.js` module that on startup attempts to read secrets from Vault using the Vault Node.js SDK, falling back to environment variables if Vault is unavailable (for backward compatibility in development).
3. Replace all direct `process.env.GROQ_API_KEY`, `process.env.JWT_SECRET`, etc. references throughout `backend/auth/AuthService.js`, `backend/auth/ApiKeyService.js`, and the Kestra flow YAML files with calls to the `secrets.js` module.
4. Update `backend/.env.example` to describe the Vault configuration variables instead of plain secret values.

```
Workflow Diagram — Secret Resolution Chain

Backend Startup
      │
      ▼
secrets.js: fetchSecret('JWT_SECRET')
      │
      ├── Vault available? ──YES──► Vault KV Store ──► return secret
      │                                                  (+ audit log)
      └── Vault unavailable? ──► process.env.JWT_SECRET ──► return secret
                                  (dev/fallback only)

Vault also handles:
  - Secret rotation (TTL-based)
  - Access audit trail
  - Dynamic DB credentials (future)
```

---

### H-07 · Circuit Breaker Pattern Across Service-to-Service Calls

**Labels:** `hard`, `backend`, `reliability`, `architecture`  
**I want to work on this issue.**

#### Problem Description

The backend's health-check loop in `backend/index.js` calls each service's `/health` endpoint using `axios.get()` with a 30-second timeout. If a service hangs (rather than fails fast), every health-check cycle for that service will block for the full 30 seconds. With three services and a 5-second polling interval, repeated timeouts can cascade into a situation where the backend's event loop is saturated with pending HTTP calls, making the entire backend unresponsive. There is no mechanism to temporarily stop calling a consistently-failing service and allow it to recover.

#### Why It Is Required

The circuit breaker pattern is a standard reliability engineering technique precisely for this scenario. Without it, a single hanging upstream service can take down the monitoring system that is supposed to be watching it — a catastrophic failure mode for infrastructure tooling. The roadmap lists "Circuit breaker pattern" as a Phase 2 reliability goal. Given that the backend's polling architecture is central to all of Sentinel's functionality, implementing this now prevents a class of cascading failures.

#### My Approach

I want to implement a lightweight circuit breaker directly in the health-check logic without introducing a heavy external library:

1. Create a `backend/lib/circuitBreaker.js` module that tracks, per service, the state (`CLOSED`, `OPEN`, `HALF_OPEN`), failure count, and the timestamp of the last failure.
2. In the `checkServiceHealth()` function in `backend/index.js`, wrap each `axios.get()` call with the circuit breaker: if the breaker is `OPEN`, skip the HTTP call and immediately report the service as `degraded`; after a configurable cool-down period, move to `HALF_OPEN` and attempt one probe call.
3. Expose the circuit breaker state for each service in the `/api/status` response so the dashboard can display it.
4. Broadcast a `CIRCUIT_BREAKER_OPEN` WebSocket event to the frontend when a breaker trips, so the `AlertFeed` component (`sentinel-frontend/components/dashboard/AlertFeed.tsx`) can show a visible warning.

```
Workflow Diagram — Circuit Breaker State Machine

              ┌─────────────────────────────────────┐
              │            CLOSED (normal)          │
              │   All HTTP calls proceed normally   │
              └──────────────┬──────────────────────┘
                             │  N consecutive failures
                             ▼
              ┌─────────────────────────────────────┐
              │        OPEN (tripped)               │
              │  Skip HTTP calls, report degraded   │
              │  Start cool-down timer (e.g. 30s)   │
              └──────────────┬──────────────────────┘
                             │  Cool-down expires
                             ▼
              ┌─────────────────────────────────────┐
              │       HALF-OPEN (probing)           │
              │  Allow one probe HTTP call          │
              │  Success? ──► CLOSED                │
              │  Failure? ──► OPEN (reset timer)    │
              └─────────────────────────────────────┘
```

---

### H-08 · Redis Caching Layer for Metrics and Status Data

**Labels:** `hard`, `backend`, `performance`, `infrastructure`  
**I want to work on this issue.**

#### Problem Description

Every request to `GET /api/status`, `GET /api/activity`, and `GET /api/insights` reads directly from the in-memory JavaScript arrays in `backend/index.js`. While this is fast, it means these arrays are not shared between backend process instances. More critically, the current architecture has no caching strategy at all — the Docker metrics endpoint (`/api/docker/containers`) calls `listContainers()` and `monitor.getMetrics()` on every single HTTP request with no throttling or caching. As traffic grows and more containers are monitored, these uncached calls to the Docker daemon will become a bottleneck.

#### Why It Is Required

The roadmap lists "Redis caching layer" as a Phase 2 performance goal alongside "Database connection pooling" and "Horizontal scaling support". Introducing Redis serves two purposes: it provides a shared cache that survives backend restarts (unlike current in-memory state) and it enables horizontal scaling by allowing multiple backend instances to share state. Additionally, Redis Pub/Sub can be used to replace the current WebSocket broadcaster (`backend/websocket.js`) with a more scalable event bus.

#### My Approach

I want to add Redis to the Docker Compose stack and integrate it into the backend gradually:

1. Add a `redis` service to `docker-compose.yml` using the official `redis:7-alpine` image.
2. Create a `backend/lib/cache.js` module that wraps the `ioredis` client with simple `get`/`set`/`del` helpers and a configurable TTL.
3. Add a caching layer to the Docker containers endpoint (`/api/docker/containers`) in `backend/index.js`: cache the full container list for 10 seconds, reducing Docker daemon call frequency from "every request" to "at most every 10 seconds".
4. Cache the `/api/status` response in Redis with a 1-second TTL so that multiple concurrent WebSocket subscribers polling this endpoint do not all trigger independent in-memory reads simultaneously.

```
Workflow Diagram — Redis Caching Integration

GET /api/docker/containers
          │
          ▼
   cache.get('docker:containers')
          │
    ┌─────┴──────────────────────┐
    │ HIT (< 10s old)            │  MISS (stale or empty)
    ▼                            ▼
Return cached JSON          listContainers()
                                 │
                                 ▼
                        cache.set('docker:containers', data, 10s)
                                 │
                                 ▼
                           Return JSON
```

---

### H-09 · Full HTTPS / TLS Enforcement Across the Entire Stack

**Labels:** `hard`, `security`, `infrastructure`, `devops`  
**I want to work on this issue.**

#### Problem Description

All communication in the Sentinel stack — between the browser and the Next.js frontend, between the frontend and the Express backend, between the backend and the mock services, and between the backend and the Kestra orchestrator — occurs over plain HTTP. The `docker-compose.yml` exposes ports without TLS termination, and all service URLs in `backend/index.js` use the `http://` scheme. JWTs and API keys are transmitted in request headers over unencrypted connections. The README's security warning about changing the default `JWT_SECRET` is rendered moot if the tokens themselves travel over plain text.

#### Why It Is Required

TLS encryption is the foundational security requirement for any system that handles authentication tokens, API keys, or sensitive operational data. HTTPS is also required for Progressive Web App (PWA) features (the frontend has `sentinel-frontend/public/manifest.json` and `sentinel-frontend/public/sw.js` indicating PWA intent), service workers, and certain browser security policies. The roadmap lists "HTTPS/TLS enforcement" as a Phase 2 security goal. Transmitting JWTs over HTTP in a production environment is a critical vulnerability.

#### My Approach

I want to implement TLS termination at the edge using a reverse proxy, keeping the internal service-to-service communication on HTTP within the isolated Docker network:

1. Add an `nginx` (or `caddy`) container to `docker-compose.yml` that acts as a TLS-terminating reverse proxy for both the frontend (`:443` → `:3000`) and the backend (`:4443` → `:4000`).
2. For local development, generate self-signed certificates using `mkcert` and document the process in `docs/DEVELOPMENT.md`.
3. For production, document Let's Encrypt / Certbot configuration in `docs/DEPLOYMENT.md` (new file).
4. Update all internal URL references — including Kestra webhook targets and CLI `src/api.js` base URLs — to respect a `BASE_URL` environment variable that can be set to `https://` in production.

```
Workflow Diagram — TLS Termination Architecture

External Traffic (HTTPS)
    │
    ▼
┌──────────────────────────────────────┐
│      Nginx / Caddy (port 443/4443)   │
│      TLS termination                 │
└────────┬─────────────────┬───────────┘
         │ HTTP (internal) │ HTTP (internal)
         ▼                 ▼
   Next.js Frontend    Express Backend
   (port 3000)         (port 4000)
         │                 │
         │    Docker internal network (HTTP only)
         ▼                 ▼
   Mock Services     PostgreSQL / Kestra
```

---

### H-10 · Custom Self-Learning Healing Policies Engine

**Labels:** `hard`, `ai`, `backend`, `feature`  
**I want to work on this issue.**

#### Problem Description

Sentinel's healing logic is currently fixed and binary: if a service is down, Kestra restarts it (`kestra-flows/intelligent-monitor.yaml`). The same restart action is always applied regardless of the failure type, the time of day, how many times the service has been restarted recently, or what the AI analysis suggested. While the backend does implement a basic `MAX_RESTARTS` limit and `restartTracker` in `backend/index.js`, the actual healing decision is not informed by the AI output — the LLM analysis and the restart action happen in parallel, not sequentially.

#### Why It Is Required

A truly autonomous agent must execute healing actions that are proportional and context-aware. Blindly restarting a service that is OOM-killing due to a memory leak will not solve the root cause and may mask a serious bug. The AI analysis from Groq already produces root cause and recommendations — but this output is currently only displayed on the dashboard, not acted upon. The roadmap lists "Custom healing policies" and "Intelligent Recovery Workflows tailored to failure types" as key goals. Connecting the AI's recommendations to executable healing actions is what elevates Sentinel from a monitoring tool to a true autonomous agent.

#### My Approach

I want to implement a policy engine that interprets the LLM's structured output and selects from a menu of healing actions:

1. Define a structured JSON schema for AI recommendations in `backend/lib/healingPolicy.js` — e.g., `{ action: "restart" | "scale_up" | "rollback" | "alert_only", confidence: 0-1, reason: string }`.
2. Update the Groq prompt in the Kestra flows (`kestra-flows/intelligent-monitor.yaml`) to output JSON matching this schema instead of free-form text.
3. In the Kestra webhook handler (`/api/kestra-webhook`), parse the structured AI output and pass it to a `PolicyEngine.execute(recommendation)` function in `backend/lib/healingPolicy.js` that maps the recommendation to the appropriate `healer.js` action.
4. Record every policy decision and its outcome in the database (from H-01) to build a history that can be used to tune confidence thresholds over time.

```
Workflow Diagram — Policy Engine Decision Flow

Kestra detects failure
        │
        ▼
Groq LLM analysis ──► Structured JSON:
                       { action: "scale_up",
                         confidence: 0.87,
                         reason: "OOM pattern detected" }
        │
        ▼
POST /api/kestra-webhook
        │
        ▼
backend/lib/healingPolicy.js
PolicyEngine.execute(recommendation)
        │
   ┌────┴────────────────────────────┐
   │ action: "restart"              │──► healer.restartContainer()
   │ action: "scale_up"             │──► healer.scaleService()
   │ action: "rollback"             │──► healer.recreateContainer()
   │ action: "alert_only"           │──► WebSocket ALERT event only
   └────────────────────────────────┘
        │
        ▼
Record decision + outcome in DB
```

---

## Medium-Level Issues

---

### M-01 · Structured Logging System with Log Levels and Rotation

**Labels:** `medium`, `backend`, `observability`  
**I want to work on this issue.**

#### Problem Description

All logging in `backend/index.js` uses raw `console.log()` calls with hand-crafted emoji prefixes (e.g., `🔍 Checking service health...`, `✅ ${service.name}: ...`). The `logActivity()` function pushes entries to an in-memory array, but there is no persistent log file, no log level filtering, no structured JSON output, and no log rotation. The frontend also has a `sentinel-frontend/lib/logger.ts` file, but it appears to be a stub. When running in Docker, all output goes to `stdout` as unstructured plain text, making it difficult to parse with log aggregation tools.

#### Why It Is Required

Structured logging is a prerequisite for log aggregation systems (like ELK, Loki, or CloudWatch). Without it, operators cannot filter logs by severity, search for specific error codes, or set up automated alerts on log patterns. The roadmap lists "Improve logging system" as a technical debt item and the ability to ship logs to external systems is implied by Phase 3 integrations. Additionally, unbounded `console.log` output in production can cause disk exhaustion on container hosts.

#### My Approach

I want to replace all `console.log` calls in the backend with a structured logger:

1. Add the `pino` logging library to `backend/package.json` — it produces newline-delimited JSON and has near-zero performance overhead.
2. Create `backend/lib/logger.js` that exports a configured `pino` instance with the appropriate log level (from `process.env.LOG_LEVEL`, defaulting to `info`).
3. Replace every `console.log`, `console.error`, and `logActivity()` call in `backend/index.js`, `backend/docker/monitor.js`, `backend/docker/healer.js`, and the auth services with structured `logger.info()`, `logger.warn()`, `logger.error()` calls that include relevant context fields.
4. Add a log rotation configuration (via `pino-roll` or a Docker logging driver) in `docker-compose.yml` to cap log file size.

```
Workflow Diagram — Structured Log Pipeline

backend/index.js
backend/docker/healer.js     ──► pino logger ──► stdout (JSON)
backend/auth/AuthService.js                          │
                                                     ▼
                                        docker-compose log driver
                                        (max-size: 10m, max-file: 3)
                                                     │
                                                     ▼
                                        Log aggregator (ELK / Loki)
                                        ── filter by level ──►
                                        ── search by service field ──►
                                        ── alert on error count ──►
```

---

### M-02 · Slack / PagerDuty Alert Integration for Incidents

**Labels:** `medium`, `integration`, `notifications`  
**I want to work on this issue.**

#### Problem Description

When a service goes down, Sentinel currently notifies operators only through two channels: the real-time web dashboard (via WebSocket) and the CLI. There is no outbound notification to any team communication platform. Engineers who are not actively watching the dashboard — which is most engineers, most of the time — will only learn about an incident if they happen to check. The `services/notification-service/` is a mock service used for demonstrating failure scenarios, not for sending real alerts.

#### Why It Is Required

Push notifications are the cornerstone of incident response. The first step in any incident management process is alerting the right people immediately. The roadmap lists "PagerDuty — Incident alerting" and "Slack — Team notifications" as Phase 3 integration goals. The frontend already has a `NotificationCenter` component (`sentinel-frontend/components/notifications/NotificationCenter.tsx`) and `NotificationPreferencesPanel` (`sentinel-frontend/components/settings/`), suggesting the UI scaffolding is in place. Without a working notification backend, these UI components have nothing to call.

#### My Approach

I want to implement a notification dispatch service in the backend:

1. Create `backend/lib/notifier.js` with two pluggable adapters: `SlackNotifier` (using Slack's Incoming Webhooks API) and `PagerDutyNotifier` (using PagerDuty's Events API v2).
2. Configure the webhook URLs via environment variables (e.g., `SLACK_WEBHOOK_URL`, `PAGERDUTY_ROUTING_KEY`) and document them in `backend/.env.example`.
3. Call `notifier.dispatch(incident)` from the Kestra webhook handler in `backend/index.js` whenever a new AI analysis report arrives — this is the natural integration point since it fires exactly when an incident has been confirmed and analyzed.
4. Wire the frontend `NotificationPreferencesPanel` to a new `PUT /api/users/:id/notification-preferences` endpoint that stores preferences in the PostgreSQL database (via the existing `backend/db/config.js` connection).

```
Workflow Diagram — Notification Dispatch

Kestra confirms incident
        │
        ▼
POST /api/kestra-webhook
        │
        ▼
backend/lib/notifier.js
        │
   ┌────┴──────────────────────────────────┐
   │ SlackNotifier.send(incident)          │──► Slack #incidents channel
   │ PagerDutyNotifier.trigger(incident)   │──► PagerDuty alert → on-call
   └───────────────────────────────────────┘
        │
        ▼
DB: store notification_sent record
```

---

### M-03 · Improve RBAC — Fine-Grained Permission Checks on All Routes

**Labels:** `medium`, `security`, `backend`, `auth`  
**I want to work on this issue.**

#### Problem Description

The RBAC system in `backend/auth/RBACService.js` and the associated routes (`backend/routes/`) defines roles and permissions, but a review of `backend/index.js` shows that the Docker endpoints (`/api/docker/containers`, `/api/docker/try-restart/:id`, `/api/docker/scale/:service/:replicas`) use only a stub middleware called `requireDockerAuth` that has a comment reading "In a real app, check 'Authorization' header — For now, assume authenticated if internal or trusted" and immediately calls `next()` without any actual check. The webhook endpoint `POST /api/kestra-webhook` and the action endpoint `POST /api/action/:service/:type` are also completely unprotected — anyone who can reach the backend port can trigger a service restart or inject a fake AI report.

#### Why It Is Required

The most critical endpoints in the backend are the ones that have no authentication. An attacker who can send a POST to `/api/action/auth/down` can crash the auth service. An attacker who can POST to `/api/kestra-webhook` can inject arbitrary AI analysis text into the dashboard. The RBAC system exists but is only applied to the `auth`, `users`, and `roles` route groups. Completing the RBAC coverage is essential for even basic production security and is listed as a Phase 2 security goal in the roadmap.

#### My Approach

I want to complete the RBAC integration for all currently unprotected routes:

1. Replace the `requireDockerAuth` stub in `backend/index.js` with the real JWT authentication middleware from `backend/auth/middleware.js`, requiring a valid bearer token.
2. Add permission-level checks to each Docker endpoint using the existing `RBACService` — for example, `docker:read` for listing containers and `docker:write` for restart/scale operations.
3. Protect `POST /api/kestra-webhook` with a shared secret (a `KESTRA_WEBHOOK_SECRET` environment variable) verified via a constant-time comparison, since Kestra cannot send a JWT.
4. Add `POST /api/action/:service/:type` behind a `simulations:write` permission so only authorized users can trigger chaos actions.

```
Workflow Diagram — RBAC Request Flow

Incoming Request
      │
      ▼
middleware.js: verifyJWT(req)
      │
  ┌───┴──────────────────────────────┐
  │ Invalid / missing token          │──► 401 Unauthorized
  └───┬──────────────────────────────┘
      │ Valid JWT → req.user = { id, role }
      ▼
RBACService.hasPermission(req.user, required_permission)
      │
  ┌───┴──────────────────────────────┐
  │ Permission denied                │──► 403 Forbidden
  └───┬──────────────────────────────┘
      │ Permission granted
      ▼
Route handler executes
```

---

### M-04 · Real SLO Burn-Rate Alerting in the Backend

**Labels:** `medium`, `backend`, `slo`, `feature`  
**I want to work on this issue.**

#### Problem Description

The SLO system (`backend/slo/calculator.js`, `backend/slo/tracker.js`, `backend/routes/slo.routes.js`, and `backend/models/slo-definition.js`) and the frontend SLO dashboard (`sentinel-frontend/app/dashboard/slo/page.tsx`) are present in the codebase. However, the SLO tracker does not proactively alert when the error budget is being consumed faster than expected. There are no burn-rate alerts that would notify an operator when, for example, the error budget for the auth-service will be exhausted in 2 hours at the current consumption rate.

#### Why It Is Required

Burn-rate alerting is the core operational value of an SLO system. Simply displaying current SLO compliance on a dashboard is useful, but reactive. Google's SRE workbook describes burn-rate alerts as the most reliable way to detect SLO violations before the entire error budget is consumed. Without burn-rate alerts, operators must constantly watch the SLO dashboard manually, which defeats the purpose of an autonomous monitoring system. This feature connects the SLO system to the existing incident/notification infrastructure.

#### My Approach

I want to implement multi-window burn-rate alerting within the backend's SLO tracker:

1. Extend `backend/slo/calculator.js` to compute the current burn rate (actual error rate ÷ allowed error rate) over configurable short (1h) and long (6h) windows.
2. In `backend/slo/tracker.js`, add a periodic check (e.g., every 60 seconds) that evaluates the burn rate against configurable alert thresholds (e.g., burn rate > 14x for the short window AND > 1x for the long window triggers a "critical" alert).
3. When a burn-rate threshold is breached, call `logActivity('alert', ...)` and broadcast an `SLO_BURN_RATE_ALERT` WebSocket event to the frontend.
4. Wire the alert to the notifier from M-02 so that burn-rate violations also generate Slack/PagerDuty notifications.

```
Workflow Diagram — Burn-Rate Alert Logic

Every 60 seconds:
tracker.js evaluates all active SLOs
        │
        ▼
For each SLO:
  burnRate_1h = error_rate_1h / slo_error_budget
  burnRate_6h = error_rate_6h / slo_error_budget
        │
   ┌────┴──────────────────────────────────┐
   │ burnRate_1h > 14x AND burnRate_6h > 1x│──► CRITICAL alert
   │ burnRate_1h > 6x  AND burnRate_6h > 1x│──► WARNING alert
   │ Otherwise                             │──► No alert
   └───────────────────────────────────────┘
        │
        ▼
WebSocket: SLO_BURN_RATE_ALERT
Notifier:  Slack / PagerDuty (from M-02)
DB:        Record alert in incidents table
```

---

### M-05 · CLI Output Formatting and Color-Coded JSON Reports

**Labels:** `medium`, `cli`, `developer-experience`  
**I want to work on this issue.**

#### Problem Description

The Sentinel CLI (`cli/index.js`, `cli/src/commands.js`) already uses `chalk` for color output and `cli-table3` for table formatting. However, the `sentinel report` command currently outputs an unformatted AI analysis string that can be hundreds of characters long, rendered as a single line without any structure. Additionally, there is no `--json` flag for any command, making it difficult to pipe CLI output into other tools (e.g., `sentinel status --json | jq '.services.auth'`). The `sentinel simulate` command also provides no feedback on whether the simulation was successfully registered by the backend before returning.

#### Why It Is Required

CLI usability is a key part of the developer experience that Sentinel advertises. A CLI that produces machine-readable output is essential for scripting, CI/CD pipelines, and integration with other DevOps tools. The README showcases the CLI as a "power user" feature and shows formatted output in the example screenshot. Inconsistent formatting and missing `--json` flags make the CLI feel unpolished and limit its usefulness in automated pipelines.

#### My Approach

I want to enhance the CLI output layer without changing the underlying API calls:

1. Add a global `--json` flag in `cli/index.js` that, when present, causes all commands to output raw JSON to `stdout` instead of formatted tables, enabling piping and scripting.
2. Reformat the `sentinel report` output in `cli/src/commands.js` to use `chalk`'s `boxen`-style formatting with word-wrapped lines and colored section headers (e.g., "Root Cause:", "Recommendation:" highlighted in yellow).
3. Add a spinner (using `ora`) to the `sentinel simulate` command that persists until the backend confirms the simulation was applied (by polling the status endpoint), giving the user clear feedback on completion.
4. Add a `sentinel report --export <file>` sub-option that writes the full AI report to a Markdown file, reusing the export logic already present in `sentinel-frontend/lib/export.ts` as a reference.

```
Workflow Diagram — CLI Output Pipeline

sentinel status
      │
      ├── (no flags) ──► cli-table3 formatted table with chalk colors
      └── --json      ──► JSON.stringify(data) to stdout

sentinel report
      │
      ├── (default) ──► chalk boxen with word-wrap, colored headers
      └── --export out.md ──► Markdown file write

sentinel simulate auth down
      │
      ▼
POST /api/action/auth/down  (with ora spinner)
      │
      ▼
Poll GET /api/status until auth !== 'healthy'
      │
      ▼
Spinner resolves: "✅ auth-service is now DOWN"
```

---

### M-06 · Frontend Accessibility (a11y) Audit and Fixes

**Labels:** `medium`, `frontend`, `accessibility`, `quality`  
**I want to work on this issue.**

#### Problem Description

The Sentinel frontend (`sentinel-frontend/`) is a rich, interactive React application built with Next.js and Tailwind CSS. A quick review of components such as `sentinel-frontend/components/dashboard/AlertFeed.tsx`, `sentinel-frontend/components/dashboard/ContainerCard.tsx`, and `sentinel-frontend/app/dashboard/page.tsx` reveals missing `aria-label` attributes on icon-only buttons, missing `role` attributes on custom interactive elements, and status indicators (colored dots/badges) that convey information purely through color with no text alternative. The `StatusBadge` component (`sentinel-frontend/components/common/StatusBadge.tsx`) uses only color to indicate status.

#### Why It Is Required

Web accessibility is both a legal requirement (WCAG 2.1 AA in many jurisdictions) and a quality indicator. Screen reader users, keyboard-only users, and users with color vision deficiency cannot effectively use a dashboard that relies entirely on color and icon-only controls. The project's goal of being used in enterprise environments makes this especially relevant. Additionally, accessibility improvements often also improve the general UX for all users through better semantic structure and keyboard navigation.

#### My Approach

I want to conduct a systematic a11y audit and fix the highest-impact issues:

1. Run an automated audit using `axe-core` (integrate it into the existing Vitest setup at `sentinel-frontend/vitest.config.mjs`) against the key page components to identify WCAG violations programmatically.
2. Add descriptive `aria-label` or `aria-describedby` attributes to all icon-only buttons (e.g., the heal/restart buttons in `ContainerCard`, the notification bell in `DashboardHeader`).
3. Update `StatusBadge` to include a visually-hidden text label alongside the color indicator (e.g., `<span className="sr-only">Healthy</span>`) so screen readers can convey the status.
4. Ensure all modal dialogs (`CreateSLOModal`, `LogExportModal`, `KeyboardShortcutsModal`) trap focus correctly when open and return focus to the triggering element when closed.

```
Workflow Diagram — a11y Audit & Fix Cycle

axe-core automated scan
        │
        ▼
Violations report (by WCAG criterion)
        │
   ┌────┴──────────────────────────────────────────────┐
   │ 1.4.1 Color alone   ──► Add sr-only text to badges│
   │ 4.1.2 Name/Role     ──► Add aria-label to buttons │
   │ 2.1.1 Keyboard      ──► Fix focus trap in modals  │
   └───────────────────────────────────────────────────┘
        │
        ▼
Re-run axe-core scan ──► Zero critical violations
```

---

### M-07 · Docker Health-Check Directives in All Service Dockerfiles

**Labels:** `medium`, `infrastructure`, `docker`, `reliability`  
**I want to work on this issue.**

#### Problem Description

The Dockerfiles for all three mock services (`services/auth-service/Dockerfile`, `services/payment-service/Dockerfile`, `services/notification-service/Dockerfile`) and the backend (`backend/Dockerfile`) do not contain any `HEALTHCHECK` directive. Docker's built-in health-check mechanism is therefore disabled for all containers. When a container is running but its application is in a crash loop or deadlock, Docker reports it as `running` rather than `unhealthy`, preventing Docker Compose from restarting it automatically and giving false information to anyone inspecting `docker ps`.

#### Why It Is Required

The `HEALTHCHECK` directive is what causes Docker to report a container's true health status (healthy / unhealthy / starting) rather than just its process status. Without it, Docker Compose's `restart: unless-stopped` policy cannot distinguish between a healthy container and one that is stuck in a crash loop. Since Sentinel monitors container health, it is ironic that Sentinel's own containers lack health checks. Adding them also unlocks Docker Compose's `condition: service_healthy` dependency ordering, which would prevent the backend from starting before its dependencies are truly ready.

#### My Approach

I want to add an appropriate `HEALTHCHECK` to each Dockerfile:

1. For each mock service (`services/*/Dockerfile`), add a `HEALTHCHECK` that uses `curl --fail http://localhost:<port>/health` with appropriate `--interval`, `--timeout`, `--start-period`, and `--retries` values, since every mock service already has a `/health` endpoint.
2. For the backend (`backend/Dockerfile`), add a `HEALTHCHECK` against `http://localhost:4000/api/status`.
3. Update `docker-compose.yml` to use `condition: service_healthy` in the `depends_on` section for the backend service so it waits for all mock services to become healthy before starting.
4. Update the CI workflow (`.github/workflows/lint-test.yml`) to verify that all containers reach a healthy state after `docker compose up`.

```
Workflow Diagram — Container Health Check Flow

docker compose up
      │
      ├── Start auth-service     ──HEALTHCHECK──► /health → 200 ──► healthy
      ├── Start payment-service  ──HEALTHCHECK──► /health → 200 ──► healthy
      ├── Start notification-service ─HEALTHCHECK─► /health → 200 ──► healthy
      │
      │   (backend depends_on: condition: service_healthy)
      │
      └── Start backend ──► All deps healthy ──► HEALTHCHECK ──► /api/status → 200
```

---

### M-08 · API Rate Limiter Per-User Scope and Custom Error Messages

**Labels:** `medium`, `backend`, `security`, `api`  
**I want to work on this issue.**

#### Problem Description

The `backend/middleware/rateLimiter.js` and `backend/auth/RateLimiterService.js` implement rate limiting, and the global `apiLimiter` is applied to all `/api` routes in `backend/index.js`. However, the rate limiter uses the default IP-address-based key, which means all users behind a shared IP (e.g., a corporate NAT or VPN) share a single rate limit bucket. When the limit is exceeded, the response body is a plain string rather than Sentinel's standard structured error format (which per the repository memories uses `SentinelError` from `backend/lib/errors.js` with `{ error: { code, message, reason, solution } }`). Additionally, there is no per-route rate limiting — the chaotic `POST /api/action/:service/:type` endpoint and the sensitive `POST /api/kestra-webhook` have the same limit as a benign `GET /api/status`.

#### Why It Is Required

IP-based rate limiting is ineffective in corporate environments where many users share an IP, and unfair in cloud environments where different clients may share IPs. User-scoped rate limiting is a standard security practice for APIs with authentication. The inconsistent error response format for rate-limit violations breaks any client that expects structured error JSON, including the frontend and the CLI. The roadmap lists "API rate limiting" and "Input validation & sanitization" as Phase 2 security goals.

#### My Approach

I want to upgrade the rate limiter to be user-aware and to produce consistent error responses:

1. Modify `backend/middleware/rateLimiter.js` to use the authenticated user's ID as the rate-limit key when a valid JWT is present, falling back to IP when unauthenticated.
2. Configure stricter rate limits for the mutation endpoints (`POST /api/action/:service/:type`, `POST /api/docker/try-restart/:id`, `POST /api/docker/scale/:service/:replicas`) and more permissive limits for read endpoints (`GET /api/status`, `GET /api/activity`).
3. Customize the `handler` function in the rate limiter to return a JSON response matching the `SentinelError` structure from `backend/lib/errors.js` with error code `RATE_LIMIT_EXCEEDED`.
4. Add the standard `Retry-After` HTTP header to rate-limit responses so clients know when to retry.

```
Workflow Diagram — User-Scoped Rate Limiting

Incoming request
      │
      ▼
middleware.js: verifyJWT (if auth header present)
      │
   ┌──┴──────────────────────────────────────────┐
   │ Authenticated ──► key = userId              │
   │ Unauthenticated ──► key = IP address        │
   └──┬──────────────────────────────────────────┘
      │
      ▼
rateLimiter(key, route-specific limit)
      │
   ┌──┴──────────────────────────────────────────┐
   │ Limit not exceeded ──► next()               │
   │ Limit exceeded ──► 429 + SentinelError JSON │
   │                    + Retry-After header     │
   └─────────────────────────────────────────────┘
```

---

### M-09 · Historical Metrics Retention and Trend Visualization

**Labels:** `medium`, `backend`, `frontend`, `analytics`  
**I want to work on this issue.**

#### Problem Description

The analytics dashboard (`sentinel-frontend/app/dashboard/analytics/page.tsx`) and the charts (`sentinel-frontend/components/analytics/TrafficChart.tsx`, `sentinel-frontend/components/analytics/ResourcesChart.tsx`) currently render data from `sentinel-frontend/lib/mockData.ts`. There is no backend API that serves historical metrics. The backend only stores the current status in memory and has no time-series accumulation. This means the analytics page shows hardcoded demo data rather than real historical service health information, making the entire analytics section non-functional for real deployments.

#### Why It Is Required

Historical trend visualization is what transforms raw monitoring data into operational intelligence. Without it, operators cannot answer questions like: "Is the auth-service getting slower over time?", "Are incidents clustering around certain hours?", or "Is our SLO improvement initiative having an effect?" The roadmap lists "Historical analysis & trends" as a Phase 3 feature, and removing `mockData.ts` in favor of real backend data is a prerequisite for that. The existing UI components are already built; they just need a real data source.

#### My Approach

I want to implement a lightweight time-series accumulation in the backend and connect it to the existing frontend chart components:

1. Create a periodic sampling job in `backend/index.js` (or a new `backend/lib/metricsCollector.js`) that snapshots `systemStatus` every 60 seconds and writes it to a new `metrics_snapshots` database table (building on the persistence work from H-01).
2. Expose a `GET /api/metrics/history?service=auth&range=24h` endpoint that queries the database and returns a time-series array suitable for Recharts.
3. Update the frontend analytics hooks (`sentinel-frontend/hooks/useMetrics.ts`) to call the new real API endpoint instead of importing from `mockData.ts`, with a graceful fallback to mock data if the backend is unavailable.
4. Update the `TrafficChart` and `ResourcesChart` components to label axes with actual timestamps from the API response rather than hardcoded strings.

```
Workflow Diagram — Historical Metrics Pipeline

Every 60s:
metricsCollector.js ──► snapshot systemStatus ──► DB: metrics_snapshots table

GET /api/metrics/history?range=24h
        │
        ▼
SELECT from metrics_snapshots WHERE timestamp > now() - interval '24h'
        │
        ▼
Return JSON time-series array
        │
        ▼
sentinel-frontend/hooks/useMetrics.ts
        │
        ▼
TrafficChart.tsx / ResourcesChart.tsx (real data, real timestamps)
```

---

### M-10 · Backend Refactor — Convert to TypeScript

**Labels:** `medium`, `backend`, `technical-debt`, `developer-experience`  
**I want to work on this issue.**

#### Problem Description

The entire backend codebase (`backend/index.js`, `backend/auth/*.js`, `backend/docker/*.js`, `backend/routes/*.js`, `backend/slo/*.js`, `backend/lib/`) is written in plain JavaScript with no type annotations. The frontend is fully TypeScript (with `sentinel-frontend/tsconfig.json` and strict settings), and there are TypeScript type definitions for Docker container structures in `backend/docker/types.js` (likely a JSDoc file rather than a `.ts` file). Without TypeScript, there is no compile-time safety on the backend: passing the wrong type to a function, accessing a missing property on an API response, or mismatching a database schema change will only surface as a runtime error in production.

#### Why It Is Required

TypeScript adoption in the backend is listed in the roadmap under technical debt ("Refactor backend to TypeScript"). More importantly, the backend handles security-critical operations — JWT validation, RBAC permission checks, database queries, and Docker container management. Type errors in these areas can lead to authentication bypasses or data corruption. TypeScript's type system would also make the codebase significantly more approachable for new contributors, since function signatures and data shapes would be self-documenting. The frontend's existing TypeScript setup provides a template for the `tsconfig.json` and build pipeline.

#### My Approach

I want to convert the backend to TypeScript incrementally, one module at a time, without breaking existing functionality:

1. Set up a `backend/tsconfig.json` with settings compatible with Node.js 18 and add `ts-node` and `typescript` as dev dependencies in `backend/package.json`. Start with `allowJs: true` so TypeScript and JavaScript files can coexist during migration.
2. Convert the simplest, most self-contained modules first: `backend/lib/errors.js`, `backend/docker/types.js`, and `backend/db/config.js`. Rename them to `.ts` and add proper type definitions.
3. Progressively convert the auth services (`backend/auth/`) and route handlers (`backend/routes/`), adding interface definitions for request/response shapes and database row types.
4. Update the CI workflow (`.github/workflows/lint-test.yml`) to run `tsc --noEmit` on the backend (mirroring the existing frontend TypeScript check) so type regressions are caught automatically.

```
Workflow Diagram — Incremental TypeScript Migration

Phase 1 (allowJs: true — files coexist):
backend/
  ├── lib/errors.ts       ✅ (converted)
  ├── docker/types.ts     ✅ (converted)
  ├── db/config.ts        ✅ (converted)
  ├── index.js            ⏳ (pending)
  └── auth/*.js           ⏳ (pending)

Phase 2 (auth & routes):
  ├── auth/AuthService.ts ✅
  ├── routes/*.ts         ✅
  └── index.js            ⏳ (final)

Phase 3 (complete):
  └── index.ts            ✅ — tsc --noEmit passes ──► CI green
```

---

> All issues above have been authored by **@Suvam-paul145** as part of the Sentinel DevOps Agent open-source contribution initiative.  
> I want to work on every issue listed in this document.
