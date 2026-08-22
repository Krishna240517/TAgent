import { betterAuth } from "better-auth";
import { prisma } from "./db.js";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "../env.js";
import { bearer, deviceAuthorization } from "better-auth/plugins";


export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql"
    }),
    trustedOrigins: ["http://localhost:3000"],
    baseURL: "http://localhost:6001",
    basePath: "/api/auth",
    socialProviders: {
        github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET
        }
    },
    plugins: [
        deviceAuthorization({
            expiresIn: "45m",
            interval: "5s"
        }),
        bearer()
    ],

    logger: {
        level: "debug"
    }
});

