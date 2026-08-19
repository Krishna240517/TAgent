import { cancel, confirm, intro, outro, isCancel } from "@clack/prompts";
import { logger } from "better-auth";
import chalk from "chalk";
import { Command } from "commander";
import fs from "fs/promises";
import open from "open";
import os from "os";
import path from "path";
import yoctoSpinner from "yocto-spinner";
import * as z from "zod/v4";
import { env } from "../../../env.js";
import { prisma } from "../../../lib/db.js";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";


const URL = env.BACKEND_URL!;
const CLIENT_ID = env.GITHUB_CLIENT_ID!;
const CONFIG_DIR = path.join(os.homedir(), ".better-auth-tagent");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");


type StoredToken = {
    access_token: string;
    refresh_token: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
};
type StoredTokenFile = {
    access_token: string;
    refresh_token: string;
    token_type: string;
    scope?: string;
    expires_at: string | null;
    created_at: string;
};
type BetterAuthDeviceClient = ReturnType<typeof createAuthClient> & {
    device: {
        code: (...args: any[]) => Promise<any>;
        token: (...args: any[]) => Promise<any>;
    };
};
export async function getStoredToken(): Promise<StoredTokenFile | null> {
    try {
        const data = await fs.readFile(TOKEN_FILE, "utf-8");
        const token = JSON.parse(data);
        return token;
    } catch (e) {
        return null;
    }
};

export async function storeToken(token: StoredToken) {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        const tokenData = {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            token_type: token.token_type || "Bearer",
            scope: token.scope,
            expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
            created_at: new Date().toISOString()
        };

        await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2), "utf-8");
        return true;
    } catch (e: unknown) {
        if (e instanceof Error) {
            console.error(chalk.red("Failed to Store token:"), e.message);
        }
    }
};

export async function clearStoredToken() {

    try {
        await fs.unlink(TOKEN_FILE);
        return true;
    } catch (e) {
        return false;
    }
};

export async function isTokenExpired() {
    const token = await getStoredToken();
    if (!token || !token.expires_at) return true;

    const expiresAt = new Date(token.expires_at);
    const now = new Date();

    return expiresAt.getTime() - now.getTime() < 1 * 60 * 1000;
}
export async function requireAuth() {
    const token = await getStoredToken();

    if (!token) {
        console.log(
            chalk.red("❌ Not authenticated. Please run 'your-cli login' first.")
        );
        process.exit(1);
    }

    if (await isTokenExpired()) {
        console.log(
            chalk.yellow("⚠️  Your session has expired. Please login again.")
        );
        console.log(chalk.gray("   Run: your-cli login\n"));
        process.exit(1);
    }

    return token;
}

async function pollForToken(
    authClient: BetterAuthDeviceClient,
    deviceCode: string,
    clientId: string,
    initialInterval: number) {
    let pollingInterval = initialInterval;
    const spinner = yoctoSpinner({ text: "", color: "cyan" });
    let dots = 0;

    return new Promise<any>((resolve, reject) => {
        const poll = async () => {
            dots = (dots + 1) % 4;
            spinner.text = chalk.gray(
                `Polling for authorization${".".repeat(dots)}${" ".repeat(3 - dots)}`
            );
            if (!spinner.isSpinning) spinner.start();

            try {
                const { data, error } = await authClient.device.token({
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    device_code: deviceCode,
                    client_id: clientId,
                    fetchOptions: {
                        headers: {
                            "user-agent": `Better Auth CLI`,
                        },
                    },
                });

                if (data?.access_token) {
                    console.log(
                        chalk.bold.yellow(`Your access token: ${data.access_token}`)
                    );
                    spinner.stop();
                    resolve(data);
                    return;
                } else if (error) {
                    switch (error.error) {
                        case "authorization_pending":
                            break;
                        case "slow_down":
                            pollingInterval += 5;
                            break;
                        case "access_denied":
                            spinner.stop();
                            logger.error("Access was denied by the user");
                            process.exit(1);
                        case "expired_token":
                            spinner.stop();
                            logger.error("The device code has expired. Please try again.");
                            process.exit(1);
                        default:
                            spinner.stop();
                            logger.error(`Error: ${error.error_description}`);
                            process.exit(1);
                    }
                }
            } catch (err: unknown) {
                spinner.stop();

                if (err instanceof Error) {
                    logger.error(`Network error: ${err.message}`);
                } else {
                    logger.error("Unknown network error");
                }

                process.exit(1);
            }

            setTimeout(poll, pollingInterval * 1000);
        };

        setTimeout(poll, pollingInterval * 1000);
    });
}



/* FUNCTIONAL COMMANDS */
export async function loginAction(opts: unknown) {
    const options = z.object({
        serverUrl: z.string().optional(),
        clientId: z.string().optional()
    }).parse(opts);


    const serverUrl = options.serverUrl || URL;
    const clientId = options.clientId || CLIENT_ID;

    intro(chalk.bold("Better Auth CLI Login"));

    if (!clientId) {
        logger.error("CLIENT_ID is not set in .env file");
        console.log(
            chalk.red("\n❌ Please set GITHUB_CLIENT_ID in your .env file")
        );
        process.exit(1);
    }

    const existingToken = await getStoredToken();
    const expired = await isTokenExpired();

    if (existingToken && !expired) {
        const shouldReauth = await confirm({
            message: "You're already logged in. Do you want to log in again?",
            initialValue: false,
        });

        if (isCancel(shouldReauth) || !shouldReauth) {
            cancel("Login cancelled");
            process.exit(0);
        }

        
    }

    const authClient = createAuthClient({
        baseURL: serverUrl,
        plugins: [deviceAuthorizationClient()]
    });

    const spinner = yoctoSpinner({ text: "Requesting Device Authorization..." });
    spinner.start();

    try {
        const { data, error } = await authClient.device.code({
            client_id: clientId,
            scope: "openid profile email"
        });

        spinner.stop();

        if (error || !data) {
            logger.error(
                `Failed to request device authorization: ${error?.error_description || error?.message || "Unknown error"
                }`
            );

            if (error?.status === 404) {
                console.log(chalk.red("\n❌ Device authorization endpoint not found."));
                console.log(chalk.yellow("   Make sure your auth server is running."));
            } else if (error?.status === 400) {
                console.log(
                    chalk.red("\n❌ Bad request - check your CLIENT_ID configuration.")
                );
            }

            process.exit(1);
        }

        const {
            device_code,
            user_code,
            verification_uri,
            verification_uri_complete,
            interval = 5,
            expires_in,
        } = data;

        console.log("");
        console.log(chalk.cyan("Device Authrorization Required..."));
        console.log("");
        console.log(
            `Please visit ${chalk.underline.blue(verification_uri_complete || verification_uri)}`
        );
        console.log(`Enter Code: ${chalk.bold.green(user_code)}`);
        console.log("");


        const shouldOpen = await confirm({
            message: "Open Browser Automatically",
            initialValue: true
        });

        if (!isCancel(shouldOpen) && shouldOpen) {
            const urlToOpen = verification_uri_complete || verification_uri;
            await open(urlToOpen);
        }

        //todo: polling start kardena
        console.log(
            chalk.gray(
                `Waiting for Authorization (expires in ${Math.floor(expires_in / 60)} minutes)...`
            )
        );

        const token = await pollForToken(
            authClient,
            device_code,
            clientId,
            interval
        );

        if (token) {
            const saved = await storeToken(token);
            if (!saved) {
                console.log(
                    chalk.yellow("\n⚠️  Warning: Could not save authentication token.")
                );
                console.log(
                    chalk.yellow("   You may need to login again on next use.")
                );
            }
        }

        const { data: session } = await authClient.getSession({
            fetchOptions: {
                headers: {
                    authorization: `Bearer ${token.access_token}`
                }
            }
        });

        outro(
            chalk.green(
                `Login Successfull! Welcome ${session?.user?.name || session?.user?.email || "User"}`
            )
        );

        console.log(chalk.gray(`\n Token saved to : ${TOKEN_FILE}`))
        console.log(
            chalk.gray("   You can now use AI commands without logging in again.\n")
        );
    } catch (e: unknown) {
        spinner.stop();
        console.error(chalk.red("\nLogin Failed"), e.message);
        process.exit(1);
    }
}


export async function logoutAction() {
    intro(chalk("Performing Logout Action"))
    const token = await getStoredToken();
    if (!token) {
        console.log(chalk.red("Already Logged Out"));
        process.exit(0);
    }

    const shouldLogout = await confirm({
        message: "Do you really want to logout ?",
        initialValue: false
    });

    if (isCancel(shouldLogout) || !shouldLogout) {
        cancel("Logout Cancelled");
        process.exit(0);
    }

    const cleared = await clearStoredToken();

    if (cleared) {
        outro(chalk.green("Successfully Logged Out"));
    } else {
        console.log(chalk.yellow(" Could not clear token file."));
        console.log(chalk.bgYellow.white(`You can manually delete the token file in this path:\n ${CONFIG_DIR}`));
    }
};


export async function whoamiAction(opts) {
    const token = await requireAuth();
    if (!token?.access_token) {
        console.log("No access token found. Please login.");
        process.exit(1);
    }

    const user = await prisma.user.findFirst({
        where: {
            sessions: {
                some: {
                    token: token.access_token
                }
            }
        },
        select: {
            id: true,
            name: true,
            email: true,
        }
    });
    if (!user) {
        console.log(chalk.red("User not found."));
        process.exit(1);
    }
    console.log(
        chalk.bold.greenBright(`
👤 User: ${user.name}
📧 Email: ${user.email}
👤 ID: ${user.id}`)
    );
}


export const login = new Command("login")
    .description("Login to Better Auth")
    .option("--server-url <url>", "The Better Auth Server URl", URL)
    .option("--client-id <id>", "The OAUTH client id", CLIENT_ID)
    .action(loginAction)

export const logout = new Command("logout")
    .description("Logout and clear stored credentials")
    .action(logoutAction);

export const whoami = new Command("whoami")
    .description("Show current authenticated user")
    .option("--server-url <url>", "The Better Auth server URL", URL)
    .action(whoamiAction);