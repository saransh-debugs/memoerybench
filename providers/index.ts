// Export types (new simplified interface)
export * from "./types";

// Export legacy template type (avoid duplicate exports with types.ts)
export { type TemplateType } from "./_template";

// Export existing providers
export { default as AQRAGProvider } from "./AQRAG";
export { default as ContextualRetrievalProvider } from "./ContextualRetrieval";
