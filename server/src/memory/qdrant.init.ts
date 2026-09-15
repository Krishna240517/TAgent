import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../env.js";


const qdrantClient = new QdrantClient({
    url: env.QDRANT_URL
});

export default qdrantClient;