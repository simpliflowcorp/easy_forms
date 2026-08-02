/**
 * Mock llmClient for testing - provides a mock retryLLM function
 * This module is loaded instead of the real llmClient via import hook
 */

import { LLMUsage } from '@/lib/llmClient';

interface MockLLMResponse {
  content: string;
  tool_calls?: any[];
  usage?: LLMUsage;
}

const mockLLMResponses = new Map<string, Array<{ content: string; tool_calls?: any[]; usage?: LLMUsage }>>();
const mockResponseIndex = new Map<string, number>();

function getMockLLMResponse(key: string) {
  const responses = mockLLMResponses.get(key);
  if (!responses || responses.length === 0) return null;
  
  const idx = mockResponseIndex.get(key) || 0;
  if (idx >= responses.length) return responses[responses.length - 1];
  mockResponseIndex.set(key, idx + 1);
  return responses[idx];
}

function getPersonaFromMessages(messages: any[]) {
  const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
  if (systemPrompt.includes('DRAFTER')) return 'drafter';
  if (systemPrompt.includes('PLANNER')) return 'planner';
  if (systemPrompt.includes('EVALUATOR')) return 'evaluator';
  if (systemPrompt.includes('COMMUNICATOR')) return 'communicator';
  return 'default';
}

export async function retryLLM(
  messages: any[],
  options: any = {},
  retry: any = {}
): Promise<any> {
  const provider = process.env.LLM_PROVIDER || 'nvidia';
  const defaultModel = process.env.LLM_PROVIDER === 'google' ? 'gemini-2.0-flash' : 'meta/llama-3.1-8b-instruct';
  const model = options.model || process.env.LLM_MODEL || 'meta/llama-3.1-8b-instruct';
  
  const key = getPersonaFromMessages(messages);
  const response = getMockLLMResponse(key);
  
  if (!response) {
    return {
      role: 'assistant',
      content: JSON.stringify({
        thoughtProcess: 'Mock response',
        isComplete: true,
        shouldRetry: false,
        feedback: 'Mock evaluation complete',
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'mock' },
    };
  }
  
  return {
    role: 'assistant',
    content: response.content,
    tool_calls: response.tool_calls,
    usage: response.usage || { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'mock' },
  };
}

export function setMockLLMResponse(key: string, responses: Array<{ content: string; tool_calls?: any[]; usage?: any }>) {
  mockLLMResponses.set(key, responses);
  mockResponseIndex.set(key, 0);
}

export function clearMockLLMResponses() {
  mockLLMResponses.clear();
  mockResponseIndex.clear();
}

export class LLMOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMOfflineError';
  }
}

export class LLMRateLimitError extends Error {
  constructor(message: string, public status: number = 429) {
    super(message);
    this.name = 'LLMRateLimitError';
  }
}

export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

export class LLMHTTPError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'LLMHTTPError';
  }
}

export class LLMParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMParseError';
  }
}

export class LLMBudgetExceededError extends Error {
  constructor(message: string, public budgetType: 'per_ticket' | 'per_day') {
    super(message);
    this.name = 'LLMBudgetExceededError';
  }
}

export function parseUsage(rawUsage: any, model: string) {
  return null;
}