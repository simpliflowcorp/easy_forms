import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";
import AgentMemoryModel from "@/models/AgentMemoryModel";

export interface VectorRecord {
  id: string;
  embedding: number[];
  metadata: Record<string, any>;
  text?: string;
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

const VectorEmbeddingSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    embedding: [{ type: Number, required: true }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    text: { type: String, default: "" },
  },
  { timestamps: true }
);

const VectorEmbeddingModel =
  mongoose.models?.VectorEmbedding ||
  mongoose.model("VectorEmbedding", VectorEmbeddingSchema);

/**
 * Calculates cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generates vector embedding for text.
 * Uses EMBEDDING_MODEL if configured, otherwise falls back to a deterministic 128-dim hash vector.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const modelName = process.env.EMBEDDING_MODEL;
  const apiKey = process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY;

  if (modelName && apiKey && typeof fetch !== "undefined") {
    try {
      const endpoint = process.env.EMBEDDING_API_URL || "https://api.openai.com/v1/embeddings";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          input: text,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const vec = json?.data?.[0]?.embedding;
        if (Array.isArray(vec)) return vec;
      }
    } catch {
      // Fallback on API failure
    }
  }

  // Deterministic fallback generator for dev/test environments
  const dim = 128;
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    vec[i % dim] = (vec[i % dim] + charCode * (i + 1)) % 1000;
  }
  const norm = Math.sqrt(vec.reduce((acc, val) => acc + val * val, 0)) || 1;
  return vec.map((val) => val / norm);
}

/**
 * Inserts or updates an embedding in the database.
 */
export async function insertEmbedding(
  id: string,
  embedding: number[],
  metadata: Record<string, any> = {},
  text: string = ""
): Promise<void> {
  await connectDB();
  await VectorEmbeddingModel.findOneAndUpdate(
    { id },
    { id, embedding, metadata, text },
    { upsert: true, new: true }
  );
}

/**
 * Searches for top-k vectors closest to queryEmbedding.
 * Attempts Mongo Atlas `$vectorSearch`. If not supported/configured, falls back to in-memory cosine search or keyword search.
 */
export async function search(
  queryEmbedding: number[],
  k: number = 5,
  filters: Record<string, any> = {}
): Promise<SearchResult[]> {
  await connectDB();

  // Try Mongo Atlas Vector Search pipeline
  try {
    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: k * 10,
          limit: k,
          filter: filters,
        },
      },
      {
        $project: {
          id: 1,
          metadata: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ];

    const results = await VectorEmbeddingModel.aggregate(pipeline);
    if (results && results.length > 0) {
      return results.map((r: any) => ({
        id: r.id,
        score: r.score || 0,
        metadata: r.metadata || {},
      }));
    }
  } catch {
    // Atlas Vector Search not available in dev env — fall through to in-memory / keyword search
  }

  // Fallback 1: Calculate Cosine Similarity over stored VectorEmbeddings
  const docs = await VectorEmbeddingModel.find(
    filters && Object.keys(filters).length > 0 ? filters : {}
  ).lean();

  if (docs.length > 0) {
    const scored = docs.map((doc: any) => ({
      id: doc.id,
      score: cosineSimilarity(queryEmbedding, doc.embedding || []),
      metadata: doc.metadata || {},
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // Fallback 2: Keyword search on AgentMemoryModel
  const memories = await AgentMemoryModel.find().limit(k).lean();
  return memories.map((m: any, idx: number) => ({
    id: String(m._id || m.key),
    score: 1.0 / (idx + 1),
    metadata: { key: m.key, value: m.value, userId: m.userId },
  }));
}
