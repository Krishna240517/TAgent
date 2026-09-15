import { Memory } from "mem0ai/oss";
import { env } from "../env.js";
const memory = new Memory({
    llm: {
        provider:"openai",
        config: {
            apiKey: env.OPENROUTER_API_KEY || "",
            baseURL: "https://openrouter.ai/api/v1",
            model: "gpt-4o-mini",
        }
    },
    embedder: {
        provider: "google",
        config: {
            apiKey: env.GEMINI_API_KEY,
            model: "text-embedding-004"
        }
    },

    vectorStore: {
        provider: "qdrant",
        config: {
            collectionName:"long-term-mem",
            dimension: 768,
        }
    },
});

export default memory;

