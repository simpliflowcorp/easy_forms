 I've written the documentation to docs/agent/AGENT-OVERVIEW.md. Here's a summary of what I found and documented across the four sections:                                   
                                                                                                                                                                             
 Memory                                                                                                                                                                      
                                                                                                                                                                             
 The agent has 5 disconnected memory stores (Mongo ticket, Redis resume cache, Redis sandbox at 24h TTL, a 3-ticket recent-context window pulled per Drafter call, and       
 static prompt files). Key gaps:                                                                                                                                             
 - No cross-session / long-term memory — context is just a 3-ticket sliding window, and there's no push-back of learned preferences.                                         
 - Mongo and Redis can drift (shouldPersistToMongo only writes Mongo on select transitions), despite the code claiming Mongo is authoritative.                               
 - Sandbox grows unbounded within the 24h window; trace is capped but sandbox isn't.                                                                                         
 - PII redaction is key-name-only; value-based redaction is off by default even for the Evaluator/Communicator handling raw responses.                                       
                                                                                                                                                                             
 Loop                                                                                                                                                                        
                                                                                                                                                                             
 A while (isLooping) over activePersona (Drafter → Planner → Executor → Evaluator → Communicator), with retries routing Executor↔Evaluator and 3-iteration budget            
 (incremented only by the Evaluator). Per-user Redis lock. Gaps:                                                                                                             
 - Retries reuse the exact same actionPlan and never re-consult the Planner (the feedbackPreamble path is unreachable from the normal retry flow) — can't recover from       
   structurally wrong plans.                                                                                                                                                 
 - maxIterations=3 is hard-coded, shared between a 1-tool read query and a 3-mutation build.                                                                                 
 - No loop-level timeout; the 60s lock TTL is shorter than a worst-case loop, and lock.stale() only warns.                                                                   
 - simulated_offline is re-checked only in DRAFTER/PLANNER branches.                                                                                                         
 - No structured user-abort signal.                                                                                                                                          
                                                                                                                                                                             
 LLMOps                                                                                                                                                                      
                                                                                                                                                                             
 retryLLM with typed errors, 30s timeout, JSON-mode + function calling, a 10s health monitor. Gaps:                                                                          
 - No token/cost accounting (data.usage is discarded) and no per-persona latency.                                                                                            
 - No per-persona model/temperature routing despite Gemini vs Llama differences.                                                                                             
 - Health monitor only probes NVIDIA even when LLM_PROVIDER=google.                                                                                                          
 - No versioned prompt registry (the Drafter prompt has hand-numbered rules with a jump 7→20), no streaming (Communicator blocks on full completion), no structured logging, 
   no model failover.                                                                                                                                                        
 - llmRawOutput enters the trace un-redacted.                                                                                                                                
                                                                                                                                                                             
 Eval                                                                                                                                                                        
                                                                                                                                                                             
 npm run agent:eval runs runner.ts over 15 golden prompts against the real stack with binary PAS failures (tools-present × iterations × isComplete × no-error). Gaps:        
 - Known-inconsistent golden rows (e.g. create_custom_view isn't in agentToolsSchema; generate_analytics_skill expects run_database_query).                                  
 - Runs against real Mongo/Redis/LLM — non-deterministic, costs tokens, creates side effects, and would be flaky in CI.                                                      
 - Pass criteria are too coarse (tools present but not params/sandbox/reply).                                                                                                
 - No eval of the Evaluator itself (no negative "should NOT be complete" prompts).                                                                                           
 - No persisted reports, no history, no branch coverage, follow-up prompt is order-coupled.                                                                                  
                                                                                                                                                                             
 The doc ends with a prioritized roadmap (quick wins / medium / larger).     