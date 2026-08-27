import { text, password, isCancel, cancel, intro, outro } from "@clack/prompts";
import boxen from "boxen";
import chalk from "chalk";
import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import os from "os";
import yoctoSpinner from "yocto-spinner";
import { off } from "cluster";

const CONFIG_DIR = path.join(os.homedir(), ".better-auth-tagent");
const DOCKER_TOKEN_FILE = path.join(CONFIG_DIR, "docker-creds.json");

export type DockerCreds = {
    username: string;
    patToken: string;
};


export async function getStoredDockerCreds(): Promise<DockerCreds | null> {
    try {
        const data = await fs.readFile(DOCKER_TOKEN_FILE, "utf-8");
        return JSON.parse(data);
    } catch (e: any) {
        return null;
    }
};

async function storeDockerCreds(creds: DockerCreds) {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        await fs.writeFile(DOCKER_TOKEN_FILE, JSON.stringify(creds, null, 2), "utf-8");

        return true;
    } catch (e) {
        console.error(chalk.red("Failed to store Docker credentials."));
        return false;
    }
};

async function verifyDockerCredentials(username: string, patToken: string): Promise<boolean> {
    try {
        const response = await fetch("https://hub.docker.com/v2/users/login/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: patToken }),
        });
        return response.ok;
    } catch (error) {
        return false;
    }
};


export async function promptForDockerCreds(): Promise<DockerCreds> {
    console.log(
        boxen(
            chalk.white.bold("Docker Hub Authentication Required\n\n") +
            chalk.gray("To manage remote repositories, the AI needs a Personal Access Token.\n\n") +
            chalk.cyan("1. Go to ") + chalk.underline("https://hub.docker.com/settings/security\n") +
            chalk.cyan("2. Click 'New Access Token'\n") +
            chalk.cyan("3. Grant 'Read, Write, Delete' permissions\n") +
            chalk.cyan("4. Copy the token and paste it below."),
            { padding: 1, margin: 1, borderStyle: "round", borderColor: "blue" }
        )
    );

    const username = await text({
        message: "Enter your Docker Hub username:",
        validate: (value) => (!value ? "Username is required." : undefined)
    });

    if (isCancel(username)) {
        cancel("Docker authentication cancelled");
        process.exit(1);
    }

    const patToken = await password({
        message: "Enter your Docker hub Personal Access Token(PAT): ",
        validate: (value) => (!value ? "PAT is required" : undefined)
    });
    if (isCancel(patToken)) {
        cancel("Docker authentication cancelled");
        process.exit(1);
    }

    const creds = {
        username: username as string,
        patToken: patToken as string
    };

    const spinner = yoctoSpinner({ text: "Verifying Credentials with Docker Hub..." });
    const isValid = await verifyDockerCredentials(creds.username, creds.patToken);

    if (!isValid) {
        spinner.error(chalk.red("Authentication failed. Please check your username and PAT."));
        process.exit(1);
    }
    spinner.success(chalk.green("Verified successfully!"));
    await storeDockerCreds(creds);
    return creds;
}

export async function getOrPromptDockerCredentials(): Promise<DockerCreds> {
    const existing = await getStoredDockerCreds();
    if (existing) return existing;
    return await promptForDockerCreds();
};

export async function dockerLoginAction() {
    intro(chalk.bold("Docker Hub Configuration"));

    const existing = await getStoredDockerCreds();

    if (existing) {
        console.log(chalk.yellow(`Already authenticated as: ${existing.username}`));
        console.log(chalk.gray(`Use 'your-cli docker-logout' to clear these credentials.\n`));
        process.exit(0);
    }
    await promptForDockerCreds();
    outro(chalk.green("Docker Hub credentials saved securely."));
}

export async function dockerLogoutAction() {
    intro(chalk.bold("Docker Hub Logout"));

    const existing = await getStoredDockerCreds();

    if(!existing) {
        console.log(chalk.yellow("No Docker Hub credentials found. "));
        process.exit(0);
    }

    try {
        await fs.unlink(DOCKER_TOKEN_FILE);
        outro(chalk.green("Successfully logged out of the Docker Hub"));
    }
    catch(e: unknown) {
        console.error(chalk.red("Failed to Logout"));
        process.exit(1);
    }
};



export const dockerLogin = new Command("docker-login").description("Configure Docker hub credentials for the AI agent").action(dockerLoginAction);
export const dockerLogout = new Command("docker-logout").description("Remove stored Docker Hub credentials").action(dockerLogoutAction);