# R10.2 — Chaos Tests for Easy Forms Agent

## Overview
Chaos engineering tests to validate system resilience under failure conditions. Each test verifies specific failure modes and recovery behaviors.

## Test Scenarios

### 1. LLM Service Outage (Mid-Request)
**Objective**: Verify client reconnection and ticket resume after LLM service failure mid-request.

**Steps**:
1. Start a write operation (form build) that triggers LLM calls
2. Mid-request, block LLM API (e.g., firewall rule or mock service)
3. Verify:
   - Agent returns `LLMOfflineError` to client
   - Ticket status = `LLM_ERROR` in MongoDB
   - Ticket remains resumable (status != `RESOLVED`)
   - Sandbox state preserved in Redis
4. Restore LLM service
5. Resume ticket via `onResume(ticketId)`
6. Verify successful completion

**Expected Behavior**:
- `runCommunicator` catches `LLMOfflineError` → sets `status: "LLM_ERROR"`, `isComplete: false`
- `agentLoop` catches error → `handleFailure` persists `LLM_ERROR` to MongoDB
- Client receives friendly message: "AI is offline right now. You can resume this ticket when the service is back."
- Resume via WebSocket `resume` message with same `ticketId`

**Validation**:
```bash
# 1. Start a build operation
curl -X POST /api/agent/execute -d '{"prompt": "build a contact form"}'

# 2. Block LLM API (e.g., iptables or mock service)
sudo iptables -A OUTPUT -d api.nvidia.com -j DROP

# 3. Wait for LLM_OFFLINE response, verify ticket status = LLM_ERROR
# 4. Restore connectivity
sudo iptables -D OUTPUT -d api.nvidia.com -j DROP

# 5. Resume
# Send WS message: { type: "resume", payload: { ticketId: "..." } }
```

---

### 2. MongoDB Primary Failover
**Objective**: Verify replica-set failover + agent health probe surfaces it.

**Prerequisites**:
- MongoDB replica set (3+ nodes)
- `MONGODB_URI` points to replica set

**Steps**:
1. Start agent operations (mixed read/write)
2. Step down current primary: `rs.stepDown()` in Mongo shell
3. Verify:
   - `agentLoop` handles `MongoNetworkError`/`MongoServerSelectionError`
   - `handleFailure` catches error, sets `LLM_ERROR` or appropriate status
   - `/api/agent/health` endpoint returns `unhealthy` within 10s
   - New primary elected within 30s (MongoDB default)
4. Verify agent recovers automatically (retry logic in `retryLLM`/`agentRedis`)
5. Resume any interrupted tickets

**Expected Behavior**:
- `agentRedis` operations retry on connection error
- `AgentUsageModel` writes queue or fail gracefully
- `/api/health/mongo` returns `connected: false` during failover
- Automatic recovery once new primary available

**Validation**:
```bash
# 1. Check initial health
curl /api/health/mongo

# 2. Step down primary
mongo --eval "rs.stepDown()"

# 3. Monitor health endpoint (should show unhealthy within 10s)
watch -n 2 'curl -s /api/health/mongo | jq .connected'

# 4. Verify recovery (should auto-recover within 30s)
# 5. Verify interrupted tickets are resumable
```

---

### 3. Redis Eviction / Memory Pressure
**Objective**: Verify sandbox TTL prevents active ticket data loss under memory pressure.

**Background**: 
- Active sandbox TTL: 24h (configurable)
- Read query cache TTL: 5s (per-request)
- Redis `maxmemory-policy`: `allkeys-lru` (default)

**Risk**: If Redis evicts active sandbox data mid-operation, user loses work.

**Steps**:
1. Fill Redis to near `maxmemory` (e.g., `redis-cli FLUSHALL` then write many keys)
2. Start a form build operation (creates sandbox draft)
3. Continue filling Redis to trigger eviction
4. Verify:
   - Active sandbox draft NOT evicted (24h TTL protects it)
   - Only old/read caches evicted
   - If eviction hits active sandbox → data loss (CRITICAL FAILURE)

**Mitigation Verification**:
- `sandboxRedisStore` keys have 24h TTL (`PX 86400000`)
- `agentRedis` keys have shorter TTL
- `allkeys-lru` evicts least recently used → active sandbox recently accessed → safe

**Validation**:
```bash
# 1. Check TTL on sandbox keys
redis-cli --scan --pattern "sandbox:*" | xargs -I {} redis-cli TTL {}

# 2. Fill Redis to 90% capacity
# (Use redis-benchmark or custom script)

# 3. Start build operation, verify it completes
# 4. Check no active sandbox keys were evicted
```

---

### 4. Network Partition / WS Reconnection
**Objective**: Verify WebSocket reconnection with state replay.

**Steps**:
1. Establish WS connection, start a long operation
2. Simulate network partition (e.g., `tc qdisc add dev eth0 root netem loss 100%`)
3. Verify:
   - Client detects disconnect (WS `onclose`)
   - Exponential backoff reconnect (1s, 2s, 4s... max 30s)
   - On reconnect, sends `{ type: "resume", payload: { ticketId } }`
   - Server replays missed trace entries from `localStorage` backup
4. Restore network
4. Verify operation completes successfully

**Validation**:
```javascript
// Client-side test (browser console)
const ws = new WebSocket('ws://localhost:3001/api/ws?token=...');
ws.onclose = () => console.log('Disconnected, will reconnect...');
// Simulate partition: tc qdisc add dev eth0 root netem loss 100%
// Wait for reconnect, verify state replay
```

---

## Automation

### CI Integration
```yaml
# .github/workflows/chaos-tests.yml
name: Chaos Tests
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly Sunday 2AM
  workflow_dispatch:

jobs:
  chaos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run chaos tests
        run: |
          ./tests/chaos/run-chaos-tests.sh
```

---

## Acceptance Criteria

| Test | Pass Criteria |
|------|---------------|
| LLM Outage | Ticket resumable, sandbox intact, user notified |
| Mongo Failover | Health probe detects, auto-recovers < 30s, tickets resumable |
| Redis Eviction | Active sandbox never evicted (24h TTL respected) |
| WS Reconnect | Reconnects < 2s median, state replayed from localStorage |

---

## Running Chaos Tests

```bash
# Run all chaos tests
./tests/chaos/run-all.sh

# Run specific test
./tests/chaos/test-llm-outage.sh
./tests/chaos/test-mongo-failover.sh
./tests/chaos/test-redis-eviction.sh
./tests/chaos/test-ws-reconnect.sh
```