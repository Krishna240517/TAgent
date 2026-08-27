#!/usr/bin/env bun

import chalk from "chalk";
import { Command } from "commander";
import figlet from "figlet";
import { login, logout, whoami } from "./command/auth/auth.js";
import { dockerLogin, dockerLogout } from "./command/auth/docker.auth.js";
const main = async () => {
    console.log(
        chalk.cyan(
            figlet.textSync("TAGENT", {
                font: "3D-ASCII",
                horizontalLayout: "default"
            })
        )
    );

    console.log(chalk.yellow("A CLI based Agent\n"));


    const program = new Command("tag");
    program.version("0.0.1").description("TAGENT - Device Flow Authentication");

    program.addCommand(login);
    program.addCommand(logout);
    program.addCommand(whoami);
    program.addCommand(dockerLogin);
    program.addCommand(dockerLogout);

    program.action(() => {
        program.help();
    });

    program.parse();

}

main().catch((e) => {
    console.error(chalk.red("Error running Tagen CLI:"), e);
    process.exit(1);
})
