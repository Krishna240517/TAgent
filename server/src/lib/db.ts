import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "../env";


const pool = new pg.Pool({
    connectionString: env.POSTGRES_URL
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
    adapter
});

export default async function connectDB() {
    try {
        await prisma.$connect();
        console.log("Succcessfully connected to the Database");
    } catch (e) {
        console.log("Error in connecting to Database");
        process.exit(1);
    }
}