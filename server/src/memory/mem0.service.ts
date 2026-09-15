import memory from "./mem0.init.js";

export interface MemoryContext {
    userId: string;
    conversationId: string;
    agentId?:string;
}


export class MemoryService {
    async remember(messages: Array<{role:"user" | "assistant",content: string}>,context: MemoryContext) {
        return memory.add(messages,{
            userId: context.userId,
            agentId: context.agentId,
            runId: context.conversationId,
            metadata: {
                conversationId: context.conversationId
            }
        })
    }

    async search(query: string,context: MemoryContext) {
        return memory.search(query,{
            filters:{
                user_id: context.userId
            },
            topK: 10
        })
    };

    async getAll(context: MemoryContext) {
        return memory.getAll({
            filters:{
                user_id: context.userId
            }
        })
    }
}