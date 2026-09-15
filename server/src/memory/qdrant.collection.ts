import qdrantClient  from "./qdrant.init.js";

const COLLECTION_NAME = "short-term-mem";


export async function initializeQdrant() {
    const collections = await qdrantClient.getCollections();
    
    const exists = collections.collections.some(
        (collection) => collection.name === COLLECTION_NAME
    );

    if(exists) {
        console.log(`Qdrant Collection ${COLLECTION_NAME} already exists.`)
        return;
    }

    
    await qdrantClient.createCollection(COLLECTION_NAME,{
        vectors: {
            size: 768,
            distance: "Cosine"
        }
    });
    console.log('Collection configuration complete!');
};

initializeQdrant().catch((e) => console.error(e.message));