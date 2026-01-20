import { describe, test, expect } from "bun:test";
import { LocalEmbeddingProvider } from "../src/embedding/local";

describe("LocalEmbeddingProvider", () => {
  const provider = new LocalEmbeddingProvider();

  test("should have correct properties", () => {
    expect(provider.name).toBe("local");
    expect(provider.dimensions).toBe(384);
  });

  test("should embed single text", async () => {
    const vector = await provider.embedSingle("Hello world");
    
    expect(vector).toHaveLength(384);
    expect(typeof vector[0]).toBe("number");
  });

  test("should embed multiple texts", async () => {
    const vectors = await provider.embed(["Hello", "World", "Test"]);
    
    expect(vectors).toHaveLength(3);
    vectors.forEach(v => {
      expect(v).toHaveLength(384);
    });
  });

  test("should produce normalized vectors", async () => {
    const vector = await provider.embedSingle("Test normalization");
    
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  test("should produce different vectors for different texts", async () => {
    const vec1 = await provider.embedSingle("Hello world");
    const vec2 = await provider.embedSingle("Goodbye universe");
    
    const dotProduct = vec1.reduce((sum, v, i) => sum + v * vec2[i]!, 0);
    expect(dotProduct).not.toBeCloseTo(1, 2);
  });

  test("should produce similar vectors for similar texts", async () => {
    const vec1 = await provider.embedSingle("The quick brown fox");
    const vec2 = await provider.embedSingle("The fast brown fox");
    
    const dotProduct = vec1.reduce((sum, v, i) => sum + v * vec2[i]!, 0);
    expect(dotProduct).toBeGreaterThan(0.5);
  });
});
