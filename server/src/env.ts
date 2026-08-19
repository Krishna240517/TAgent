import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const dir = typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(dir, "../.env") });

export const env = {
    BACKEND_URL: process.env.BACKEND_URL!,
    FRONTEND_URL: process.env.FRONTEND_URL!,
    BACKEND_PORT: process.env.BACKEND_PORT!,
    POSTGRES_URL: process.env.POSTGRES_URL!,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
};