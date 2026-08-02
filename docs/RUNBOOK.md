# RUNBOOK — Easy Forms Agent Incident Response

## Overview
This runbook covers incident response procedures for the Easy Forms AI Agent system. Each drill should be practiced quarterly by on-call engineers.

---

## Quick Reference

| Severity | Response Time | Escalation |
|----------|---------------|------------|
| SEV-1 (Outage) | 15 min | Page on-call + team lead |
| SEV-2 (Degraded) | 30 min | Page on-call |
| SEV-3 (Minor) | 2 hours | Assign to sprint |

---

## Drill 1: LLM Service Outage

### Scenario
NVIDIA/Gemini API becomes unavailable. Agent returns `LLMOfflineError` to users.

### Detection
- Alert: `LLMOfflineError` rate > 10/min
- Health endpoint: `GET /api/agent/health` returns `{"status":"offline"}`
- User reports: "AI is offline right now"

### Response Steps

1. **Acknowledge** (within 15 min)
   ```bash
   # Check LLM health
   curl -s /api/agent/health | jq .
   # Check LLM provider status page
   # Check NVIDIA/Gemini status pages
   ```

2. **Assess Impact**
   - Check active tickets with `LLM_ERROR` status:
     ```bash
     kubectl exec -it mongo -- mongo easyforms --eval 'db.agenttickets.find({status:"LLM_ERROR"}).count()'
     ```
   - Check Redis for stuck sandboxes:
     ```bash
     redis-cli --scan --pattern "sandbox:*" | wc -l
     ```

3. **Communicate**
   - Post to #incidents Slack: "LLM service degraded. Tickets will resume when service recovers."
   - Update status page if applicable

4. **Mitigate**
   - If provider issue: wait for provider recovery (monitor status pages)
   - If auth issue: rotate API key (see below)
   - If quota exceeded: request quota increase from provider

7. **Resolve**
   - When LLM health returns `online`:
     - Monitor auto-resume of `LLM_ERROR` tickets
     - Verify sandbox states intact
   - Post-resolution message to #incidents

### Verification
- [ ] All `LLM_ERROR` tickets auto-resumed or manually resumed
- [ ] No sandbox data loss
- [ ] Health endpoint shows `online`
- [ ] No data loss in MongoDB

---

## Drill 2: Token Budget Exceeded

### Scenario
User or system hits per-ticket (50k) or per-day (200k) token budget.

### Detection
- Alert: `LLMBudgetExceededError` rate > 5/min
- User sees: "You've reached the token limit for this conversation"

### Response Steps

1. **Assess**
   ```bash
   # Check budget alerts
   curl /api/admin/agent/usage?period=day | jq .
   
   # Check specific user
   curl /api/admin/agent/usage?userId=<id> | jq .
   ```

2. **Communicate**
   - User sees friendly message with budget info
   - If systemic: post to #incidents

3. **Mitigate**
   - **Per-ticket**: User must start new conversation (new ticket)
   - **Per-day**: User must wait until midnight UTC
   - **Admin override**: Set `BUDGET_BYPASS_USERS` env var for specific users

4. **Investigate Root Cause**
   - Runaway loop? Check `iterationCount` in tickets
   - Inefficient prompts? Review prompt templates
   - Abuse? Check for automated/scripted usage

5. **Adjust** (if needed)
   - Increase budgets: `LLM_TOKEN_BUDGET_PER_TICKET=100000`
   - Adjust per-model costs in `AgentUsage` cost calculation

### Verification
- [ ] Budget alerts return to baseline
- [ ] Affected users can resume after limit reset
- [ ] No false positives (legitimate users blocked)

---

## Drill 3: Stuck Lock (`agent_lock:write:*`)

### Scenario
Agent lock not released (crash, network partition, bug). Subsequent requests return `AgentBusyError`.

### Detection
- Alert: `AgentBusyError` rate > 5/min
- User sees: "Another agent request is already running for this user"

### Response Steps

1. **Diagnose**
   ```bash
   # Check Redis for stuck locks
   redis-cli --scan --pattern "agent_lock:write:*"
   
   # Check TTL
   redis-cli GET agent_lock:write:<userId>
   redis-cli TTL agent_lock:write:<userId>
   
   # Check if owner process alive
   # (Check pod logs for agent process)
   ```

2. **Assess Impact**
   - How many users affected?
   - Any tickets stuck in `PROCESSING`?

3. **Resolve**
   ```bash
   # Option 1: Wait for TTL expiry (60s max)
   # Option 2: Force release (if TTL > 30s and owner dead)
   redis-cli EVAL "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end" 1 agent_lock:write:<userId> <ticketId>
   
   # Verify release
   redis-cli GET agent_lock:write:<userId>
   ```

4. **Post-Mortem**
   - Why didn't lock release? (crash, network, bug?)
   - Check `agentLock.ts` release logic
   - Check for unhandled exceptions in `finally` block

### Verification
- [ ] Lock released, users can proceed
- [ ] No tickets stuck in `PROCESSING`
- [ ] Root cause identified and ticket filed

---

## Drill 4: Merge Conflict / Optimistic Concurrency Failure

### Scenario
User approves merge, but form was modified by another user/session since preview. `updatesMissed` > 0.

### Detection
- User sees: "⚠️ Warning: N change(s) couldn't be applied because the form was modified elsewhere"
- `mergeStats.updatesMissed` > 0 in trace

### Response Steps

1. **Assess**
   - How many updates missed?
   - Which forms/views affected?

2. **Communicate**
   - User sees warning in UI with merge result
   - Suggest: "Please re-open the form and try again"

3. **Resolve**
   - User re-opens form → new Drafter classification → new merge
   - Or: Admin manually resolves in MongoDB if critical

4. **Prevent**
   - Educate users: "Complete merges promptly"
   - Consider shorter sandbox TTL for high-concurrency forms

### Verification
- [ ] User can re-merge successfully
- [ ] No data loss
- [ ] Sandbox state clean after retry

---

## Drill 5: Cross-Tenant Access Attempt

### Scenario
User attempts to access another user's form via forged `form_id`.

### Detection
- Alert: `AgentBusyError` or `Permission denied` spikes
- Audit log shows failed `run_database_query` with foreign `form_id`

### Response Steps

1. **Block**
   - Verify `resolveFormIdFilter` correctly filters by `userId`
   - Check `agentTools.ts` cross-tenant guard

2. **Investigate**
   ```bash
   # Check audit logs
   mongo easyforms --eval 'db.agentauditevents.find({action:"cross_tenant_attempt"}).sort({createdAt:-1}).limit(10).toArray()'
   ```

3. **Block User** (if malicious)
   - Ban user ID in auth system
   - Revoke sessions

4. **Audit**
   - Verify no data leaked
   - File security incident report

### Verification
- [ ] Cross-tenant queries return empty/no access
- [ ] Audit log captures attempt
- [ ] No data leaked

---

## Drill 6: Redis Memory Pressure / Eviction

### Scenario
Redis `maxmemory` reached, LRU eviction threatens active sandbox data.

### Detection
- Alert: Redis `used_memory` > 90% `maxmemory`
- Redis `evicted_keys` metric increasing

### Response Steps

1. **Assess**
   ```bash
   redis-cli INFO memory | grep -E 'used_memory|maxmemory|evicted_keys'
   redis-cli --scan --pattern "sandbox:*" | xargs -I {} redis-cli TTL {} | sort -n | head -20
   ```

2. **Immediate Mitigation**
   ```bash
   # Increase maxmemory if possible
   redis-cli CONFIG SET maxmemory 4gb
   
   # Or flush non-critical caches
   redis-cli --scan --pattern "cache:*" | xargs redis-cli DEL
   ```

3. **Verify Active Sandboxes Safe**
   - Check TTL on active sandbox keys (should be > 1h)
   - Only old/read caches should evict

4. **Long-term**
   - Increase Redis `maxmemory`
   - Tune `maxmemory-policy` (currently `allkeys-lru`)
   - Consider separate Redis for sandbox vs cache

### Verification
- [ ] Redis memory < 80% maxmemory
- [ ] Active sandbox keys have TTL > 1 hour
- [ ] No active sandbox evicted

---

## Drill 7: MongoDB Replica Set Failover

### Scenario
Primary steps down, secondary promoted. Agent must handle failover.

### Detection
- Alert: MongoDB connection errors
- Health endpoint: `GET /api/health/mongo` returns `connected: false`

### Response Steps

1. **Monitor Failover**
   ```bash
   watch -n 2 'curl -s /api/health/mongo | jq .'
   ```

2. **Verify Agent Recovers**
   - Agent should retry connections (built into MongoDB driver)
   - In-flight requests may fail → handled by `handleFailure` → `LLM_ERROR`
   - Tickets become resumable

2. **Verify Post-Failover**
   - Write operations succeed
   - Read operations succeed
   - No data loss (replica set acknowledged writes)

### Verification
- [ ] Health endpoint returns `connected: true`
- [ ] New tickets process successfully
- [ ] Interrupted tickets resumable
- [ ] No data loss

---

## Communication Templates

### Slack Incident Template
```
:rotating_light: INCIDENT: <Title>
**Severity**: SEV-<1/2/3>
**Impact**: <Description>
**Status**: Investigating / Mitigating / Resolved
**Commander**: @oncall
**Updates**: Thread below
```

### Resolution Template
```
:white_check_mark: RESOLVED: <Title>
**Root Cause**: <1-2 sentences>
**Impact**: <Users affected, duration>
**Fix**: <What was done>
**Follow-up**: <Ticket link for post-mortem>
```

---

## Contact Tree

| Role | Primary | Backup |
|------|---------|--------|
| On-Call Engineer | @primary | @backup |
| Team Lead | @lead | @lead-backup |
| Engineering Manager | @em | @em-backup |
| MongoDB Admin | @mongo | @mongo-backup |
| Redis Admin | @redis | @redis-backup |

---

## Post-Mortem Template

```markdown
# Post-Mortem: <Incident Title>

## Summary
- **Date**: YYYY-MM-DD
- **Duration**: Xh Ym
- **Severity**: SEV-<1/2/3>
- **Impact**: <Users affected, features down>

## Timeline
- HH:MM - Detection
- HH:MM - Acknowledgment
- HH:MM - Mitigation started
- HH:MM - Resolution

## Root Cause
<1-2 paragraphs>

## Impact
- Users affected: X
- Tickets affected: Y
- Data loss: None / <details>

## Action Items
- [ ] <Action> - @owner - Due: YYYY-MM-DD
- [ ] <Action> - @owner - Due: YYYY-MM-DD

## Lessons Learned
- What went well?
- What could be improved?
- What was lucky?
```