# R10.3 — Canary Deployment Configuration

## Overview
Gradual rollout strategy: 5% → 25% → 100% over 3 days with automated rollback on metric thresholds.

## Deployment Strategy

### Phase 1: 5% Canary (Day 1)
- **Traffic**: 5% of users routed to new version
- **Duration**: 24 hours
- **Metrics to monitor**:
  - Error rate < 0.1%
  - p99 latency < 15s (streaming) / 5s (non-streaming)
  - Token budget alerts < 5/minute
  - Lock contention rate < 1%
  - User satisfaction (toast dismiss rate) > 95%

### Phase 2: 25% Canary (Day 2)
- **Traffic**: 25% of users
- **Duration**: 24 hours
- **Same metrics**, with relaxed thresholds for increased load

### Phase 3: 100% Rollout (Day 3)
- **Traffic**: 100%
- **Full production rollout**

## Deployment Scripts

### Kubernetes Canary Deployment (Helm/Kustomize)

```yaml
# k8s/canary-deployment.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: easy-forms-agent
  namespace: production
spec:
  replicas: 10
  strategy:
    canary:
      canaryMetadata:
        labels:
          version: canary
      stableMetadata:
        labels:
          version: stable
      steps:
        - setWeight: 5
        - pause: {duration: 24h}
        - setWeight: 25
        - pause: {duration: 24h}
        - setWeight: 100
      canaryService: easy-forms-agent-canary
      stableService: easy-forms-agent-stable
      trafficRouting:
        nginx:
          stableIngress: easy-forms-agent-ingress
      analysis:
        templates:
          - templateName: success-rate
        args:
          - name: service-name
            value: easy-forms-agent-canary
  selector:
    matchLabels:
      app: easy-forms-agent
  template:
    metadata:
      labels:
        app: easy-forms-agent
    spec:
      containers:
        - name: agent
          image: easy-forms-agent:${VERSION}
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: mongodb-secret
                  key: uri
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: redis-secret
                  key: url
            - name: NVIDIA_API_KEY
              valueFrom:
                secretKeyRef:
                  name: nvidia-secret
                  key: api-key
```

### Argo Rollouts Analysis Template

```yaml
# k8s/analysis-templates.yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service-name
  metrics:
    - name: error-rate
      interval: 5m
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[5m]))
      failureCondition: result[0] > 0.001
    - name: latency-p99
      interval: 5m
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="{{args.service-name}}"}[5m])) by (le))
      failureCondition: result[0] > 15
    - name: token-budget-alerts
      interval: 5m
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            rate(agent_budget_exceeded_total[5m])
      failureCondition: result[0] > 0.083  # 5 per minute
    - name: lock-contention
      interval: 5m
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            rate(agent_lock_contention_total[5m])
      failureCondition: result[0] > 0.01
```

### GitHub Actions Canary Workflow

```yaml
# .github/workflows/canary-deploy.yml
name: Canary Deploy
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Docker image tag to deploy'
        required: true
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options: [staging, production]

jobs:
  canary:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBECONFIG }}
      
      - name: Deploy canary
        run: |
          kubectl argo rollouts set image rollout/easy-forms-agent \
            agent=ghcr.io/${{ github.repository }}/agent:${{ github.event.inputs.version }} \
            -n production
      
      - name: Wait for 5% canary
        run: |
          kubectl argo rollouts get rollout easy-forms-agent -n production --watch
          # Wait for 5% step (auto-promotes after 24h with analysis)
      
      - name: Promote to 25%
        if: always()
        run: |
          kubectl argo rollouts promote easy-forms-agent -n production
      
      - name: Wait for 25% canary
        run: |
          kubectl argo rollouts get rollout easy-forms-agent -n production --watch
      
      - name: Full rollout
        if: always()
        run: |
          kubectl argo rollouts promote easy-forms-agent -n production

  rollback:
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Rollback
        run: |
          kubectl argo rollouts abort easy-forms-agent -n production
          kubectl argo rollouts undo easy-forms-agent -n production
```

---

## Monitoring Dashboard (Grafana)

### Key Panels
1. **Error Rate** (per service, per endpoint)
2. **Latency p50/p95/p99** (streaming vs non-streaming)
3. **Token Usage** (per ticket, per user, per day)
4. **Lock Contention Rate** (per user, per minute)
5. **WebSocket Reconnection Rate** (p50, p99)
6. **Budget Alert Rate** (per minute)
6. **Lock Contention Rate** (per minute)
7. **User Satisfaction** (toast dismiss rate)

### Alert Rules
```yaml
groups:
  - name: agent-alerts
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) 
          / sum(rate(http_requests_total[5m])) > 0.001
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.service }}"
      
      - alert: HighLatency
        expr: |
          histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 15
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High p99 latency on {{ $labels.service }}"
      
      - alert: BudgetAlertSpike
        expr: |
          rate(agent_budget_exceeded_total[5m]) > 0.083
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Token budget alerts spiking"
      
      - alert: LockContention
        expr: |
          rate(agent_lock_contention_total[5m]) > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Lock contention detected"
```

---

## Rollback Procedure

### Automated (Argo Rollouts)
```bash
# Automatic rollback on analysis failure
# Or manual:
kubectl argo rollouts abort rollout/easy-forms-agent -n production
kubectl argo rollouts undo rollout/easy-forms-agent -n production
```

### Manual (kubectl)
```bash
# Rollback to previous ReplicaSet
kubectl rollout undo deployment/easy-forms-agent -n production

# Or specific revision
kubectl rollout undo deployment/easy-forms-agent -n production --to-revision=3

# Verify
kubectl rollout status deployment/easy-forms-agent -n production
```

---

## Verification Checklist (Post-Rollout)

- [ ] Error rate < 0.1% for 1 hour
- [ ] p99 latency < 15s streaming / 5s non-streaming
- [ ] Lock contention < 1%
- [ ] Budget alerts < 5/min
- [ ] WS reconnect < 2s median
- [ ] Toast dismiss rate > 95%
- [ ] No data loss incidents
- [ ] All runbook drills pass