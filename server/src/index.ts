import express from "express";
import { env } from "./env.js";
import connectDB from "./lib/db.js";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import cors from "cors"
const app = express();
const port = env.BACKEND_PORT!;



app.use(cors({
    origin: [env.FRONTEND_URL],
    credentials: true
}));
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

app.get("/health", (req, res) => {
    res.send("OK");
});

app.get("/api/me", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });

    return res.json(session);
})


app.get("/device", async (req, res) => {
    const { user_code } = req.query;
    res.redirect(`${env.FRONTEND_URL}/device?user_code=${user_code}`)
});

app.get("/api/github/access-token", async (req, res) => {
    try {
        const headers = fromNodeHeaders(req.headers);

        const session = await auth.api.getSession({
            headers,
        });

        if (!session) {
            return res.status(401).json({
                error: "Invalid session",
                status: 401,
            });
        }

        console.log("Authenticated:", session.user.email);

        const accounts = await auth.api.listUserAccounts({
            headers,
        });

        const githubAccount = accounts.find(
            (account) => account.providerId === "github"
        );

        if (!githubAccount) {
            return res.status(404).json({
                error: "GitHub account is not linked",
            });
        }

        const result = await auth.api.getAccessToken({
            body: {
                providerId: "github",
                accountId: githubAccount.accountId,
            },
            headers,
        });

        if (!result?.accessToken) {
            return res.status(401).json({
                error: "GitHub access token unavailable",
            });
        }


        return res.json({
            accessToken: result.accessToken,
        });

    } catch (error) {
        console.error("GitHub token error:", error);

        return res.status(500).json({
            error: "Failed to obtain GitHub access token",
        });
    }
});

async function startServer() {
    await connectDB();
    app.listen(port, () => {
        console.log(`Server connected Successfully: ${env.BACKEND_URL}`);
    });
};

startServer().catch((e) => {
    console.log(e.message);
    process.exit(1);
})
