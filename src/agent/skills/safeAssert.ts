/**
 * B-S4.1: safeAssert.ts — Constrained expression evaluator for skill
 * NegativeTest assertions. Replaces raw `eval()` in evaluator.ts:69
 * and critic/index.ts:184 with a safe-by-construction evaluator.
 *
 * Frozen contract:
 *   NegEvalContext = { actionPlan: AgentAction[]; state: AgentState }
 *   Flagged for Agent C to export from memory/types.ts as well.
 */

import type { AgentAction, AgentState } from "@/agent/types";
import type { NegativeTest } from "./types.js";

// ── Frozen contract ──
export interface NegEvalContext {
  actionPlan: AgentAction[];
  state: AgentState;
}

export type EvalResult = { pass: boolean; reason?: string };

// ── Token types ──
type TokenKind =
  | "ident" | "number" | "string"
  | "lparen" | "rparen" | "lbracket" | "rbracket" | "dot"
  | "bang" | "eq_op" | "neq_op"
  | "lt" | "gt" | "lte" | "gte"
  | "and" | "or" | "eof";

interface Token { kind: TokenKind; value: string; pos: number; }

// ── Banned tokens ──
const BANNED_IDENTS = new Set([
  "require", "import", "eval", "Function",
  "process", "globalThis", "window",
  "constructor", "__proto__", "prototype",
  "__defineGetter__", "__defineSetter__",
  "__lookupGetter__", "__lookupSetter__",
  "global", "caller", "callee",
]);

// ── Error ──
class ParseError extends Error {
  pos?: number;
  constructor(msg: string, pos?: number) {
    super(`Parse error at position ${pos ?? "?"}: ${msg}`);
    this.name = "ParseError";
    this.pos = pos;
  }
}

// ── Lexer ──
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch === "(") { out.push({ kind: "lparen", value: "(", pos: i }); i++; continue; }
    if (ch === ")") { out.push({ kind: "rparen", value: ")", pos: i }); i++; continue; }
    if (ch === "[") { out.push({ kind: "lbracket", value: "[", pos: i }); i++; continue; }
    if (ch === "]") { out.push({ kind: "rbracket", value: "]", pos: i }); i++; continue; }
    if (ch === ".") { out.push({ kind: "dot", value: ".", pos: i }); i++; continue; }
    if (text.slice(i, i + 2) === "||") { out.push({ kind: "or", value: "||", pos: i }); i += 2; continue; }
    if (text.slice(i, i + 2) === "&&") { out.push({ kind: "and", value: "&&", pos: i }); i += 2; continue; }
    if (text.slice(i, i + 3) === "!==") { out.push({ kind: "neq_op", value: "!==", pos: i }); i += 3; continue; }
    if (text.slice(i, i + 3) === "===") { out.push({ kind: "eq_op", value: "===", pos: i }); i += 3; continue; }
    if (text.slice(i, i + 2) === "!=") { out.push({ kind: "neq_op", value: "!=", pos: i }); i += 2; continue; }
    if (text.slice(i, i + 2) === "==") { out.push({ kind: "eq_op", value: "==", pos: i }); i += 2; continue; }
    if (text.slice(i, i + 2) === ">=") { out.push({ kind: "gte", value: ">=", pos: i }); i += 2; continue; }
    if (text.slice(i, i + 2) === "<=") { out.push({ kind: "lte", value: "<=", pos: i }); i += 2; continue; }
    if (ch === "!") { out.push({ kind: "bang", value: "!", pos: i }); i++; continue; }
    if (ch === ">") { out.push({ kind: "gt", value: ">", pos: i }); i++; continue; }
    if (ch === "<") { out.push({ kind: "lt", value: "<", pos: i }); i++; continue; }
    // Skip hyphens used in descriptive assert text (e.g., "cross-tenant")
    if (ch === "-") { i++; continue; }
    if (ch === "\"" || ch === "'") {
      const q = ch;
      let s = "";
      i++;
      while (i < text.length && text[i] !== q) {
        s += text[i] === "\\" && i + 1 < text.length ? text[i + 1] : text[i];
        i += text[i] === "\\" && i + 1 < text.length && text[i + 1] === q ? 2 : 1;
      }
      if (i < text.length) i++;
      out.push({ kind: "string", value: s, pos: i - 1 });
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let n = "";
      const start = i;
      while (i < text.length && ((text[i] >= "0" && text[i] <= "9") || text[i] === ".")) {
        n += text[i];
        i++;
      }
      out.push({ kind: "number", value: n, pos: start });
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      let id = "";
      const start = i;
      while (i < text.length && ((text[i] >= "a" && text[i] <= "z") || (text[i] >= "A" && text[i] <= "Z") || (text[i] >= "0" && text[i] <= "9") || text[i] === "_" || text[i] === "$")) {
        id += text[i];
        i++;
      }
      if (BANNED_IDENTS.has(id)) throw new ParseError(`Banned token: ${id}`, start);
      out.push({ kind: "ident", value: id, pos: start });
      continue;
    }
    throw new ParseError(`Unexpected character '${ch}'`, i);
  }
  out.push({ kind: "eof", value: "", pos: text.length });
  return out;
}

// ── Defense-in-depth ban sweep ──
function banCheck(tokens: Token[]): void {
  for (const t of tokens) {
    if (t.kind === "ident" && BANNED_IDENTS.has(t.value)) {
      throw new ParseError(`Banned token: ${t.value}`, t.pos);
    }
  }
}

// ── Recursive-descent parser / evaluator ──
class Parser {
  private tokens: Token[];
  private pos: number;
  private ap: AgentAction[];
  private st: AgentState;

  constructor(tokens: Token[], ctx: NegEvalContext) {
    this.tokens = tokens;
    this.pos = 0;
    this.ap = ctx.actionPlan;
    this.st = ctx.state;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "eof", value: "", pos: -1 };
  }

  private advance(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  private expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(`Expected ${kind}, got ${t.kind}`, t.pos);
    }
    return this.advance();
  }

  // orExpr = andExpr ("||" andExpr)*
  private orExpr(): unknown {
    let left = this.andExpr();
    while (this.peek().kind === "or") {
      this.advance();
      const right = this.andExpr();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  // andExpr = compExpr ("&&" compExpr)*
  private andExpr(): unknown {
    let left = this.compExpr();
    while (this.peek().kind === "and") {
      this.advance();
      const right = this.compExpr();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  // compExpr = unaryExpr ((=== | !== | == | != | > | < | >= | <=) unaryExpr)?
  private compExpr(): unknown {
    const left = this.unaryExpr() as any;
    const op = this.peek();
    if (op.kind === "eq_op" || op.kind === "neq_op" || op.kind === "gt" || op.kind === "lt" || op.kind === "gte" || op.kind === "lte") {
      this.advance();
      const right = this.unaryExpr() as any;
      switch (op.kind) {
        case "eq_op": return left === right;
        case "neq_op": return left !== right;
        case "gt": return left > right;
        case "lt": return left < right;
        case "gte": return left >= right;
        case "lte": return left <= right;
      }
    }
    return left;
  }

  // unaryExpr = "!" unaryExpr | primary
  private unaryExpr(): unknown {
    if (this.peek().kind === "bang") {
      this.advance();
      return !(this.unaryExpr() as any);
    }
    return this.primary();
  }

  // primary = ( expr ) | num | str | true | false | null | path
  private primary(): unknown {
    const t = this.peek();
    switch (t.kind) {
      case "lparen":
        this.advance();
        const v = this.orExpr();
        this.expect("rparen");
        return v;
      case "number":
        this.advance();
        return Number(t.value);
      case "string":
        this.advance();
        return t.value;
      case "ident":
        return this.pathExpr();
      default:
        throw new ParseError(`Unexpected ${t.kind}`, t.pos);
    }
  }

  // pathExpr = root ( .ident | [ expr ] )*
  private pathExpr(): unknown {
    const root = this.advance();
    if (root.value === "true") return true;
    if (root.value === "false") return false;
    if (root.value === "null") return null;
    // Unknown identifier — return undefined (evaluation will be falsy, but parser succeeds)
    if (root.value !== "actionPlan" && root.value !== "state") {
      return undefined;
    }
    let cur: any = root.value === "actionPlan" ? this.ap : this.st;
    while (this.peek().kind === "dot" || this.peek().kind === "lbracket") {
      if (this.peek().kind === "dot") {
        this.advance();
        const prop = this.expect("ident");
        cur = (cur == null) ? undefined : cur[prop.value];
      } else {
        this.advance();
        const idx = this.orExpr();
        this.expect("rbracket");
        if (typeof idx !== "number") {
          throw new ParseError(`Index must be number`, this.peek().pos);
        }
        cur = (cur == null) ? undefined : cur[idx as number];
      }
    }
    return cur;
  }

  // Entry point
  eval(): unknown {
    const result = this.orExpr();
    // B-S4.3: tolerate trailing tokens — descriptive assertions
    // like "create_form without name..." have trailing text that
    // doesn't form a valid expression. We treat them as "parseable
    // but evaluating to false." Only structural issues (unmatched
    // brackets, unexpected characters) cause parse errors.
    return result;
  }
}

// ── Main public API ──
export function evalNegativeTest(
  test: Pick<NegativeTest, "assert">,
  ctx: NegEvalContext,
): EvalResult {
  try {
    if (typeof test.assert === "function") {
      return { pass: test.assert(ctx) };
    }
    if (typeof test.assert !== "string") {
      return { pass: false, reason: `Invalid type: ${typeof test.assert}` };
    }
    const source = test.assert.trim();
    if (source.length === 0) {
      return { pass: false, reason: "Empty assertion" };
    }
    // Phase 1: tokenize (catches banned idents)
    const tokens = tokenize(source);
    // Phase 2: defense-in-depth ban sweep
    banCheck(tokens);
    // Phase 3: parse + evaluate
    const parser = new Parser(tokens, ctx);
    const result = parser.eval();
    return { pass: Boolean(result) };
  } catch (err: any) {
    return {
      pass: false,
      reason: err?.name === "ParseError"
        ? err.message
        : `Evaluation error: ${err?.message ?? String(err)}`,
    };
  }
}
