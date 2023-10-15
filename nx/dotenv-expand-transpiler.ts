#!/usr/bin/env node

// USAGE in Makefile:
//
// MAKEFLAGS += --silent --jobs=15

// environment ?= development
// export DOTENV_EXPAND_PREFIXES=MYENV_,ASPNETCORE_,DOTNET_,NODE_,PRODUCTION,WORKING_ENV
// _ := $(shell bunx dotenv-cli -e .config/environment/.$(environment).env -- bun --bun ./nx/dotenv-expand-transpiler.ts ./ .env false >&2)
// include .env
// export $(shell sed 's/=.*//' .env)

import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
const { execSync } = require("child_process");

const execAsync = execSync;
async function runCommand(command, silent = false) {
  try {
    if (silent) {
      await execAsync(command, { stdio: "ignore" });
      return;
    }
    await execAsync(command, { stdio: "inherit" });
  } catch (error) {
    if (!silent) {
      console.warn("Command had an issue:", error.message);
    }
  }
}

const repoRoot = process.cwd();
const prefixes =
  String(process.argv[2]).split(",") ??
  "ASPNETCORE_,DOTNET_,NODE_,PRODUCTION,WORKING_ENV".split(",");
const outputFileDir = String(process.argv[3]) ?? "./";
const outputFileName = String(process.argv[4]) ?? ".env";
const showLogs = Boolean(process.argv[5] === "true" ? true : false);

if (showLogs) console.log(prefixes);

if (Boolean(process.isBun) !== true) {
  console.log(chalk.red("Don't run this script without Bun! Exiting..."));
  process.exit(1);
}
if (showLogs) console.log(chalk.green("Running with Bun!"));

const filterByPrefix = (key) =>
  prefixes.some((prefix) => key.startsWith(prefix));

function readAndParseEnvironment() {
  const envObject = {};

  for (const key in process.env) {
    if (filterByPrefix(key)) {
      envObject[key] = process.env[key];
    }
  }

  // Escape newlines in the environment variable values
  const escapeNewlines = (value) => {
    if (typeof value === "string") {
      return `${value.replace(/\r\n/g, "\\n").replace(/\n/g, "\\n")}`;
    }
    return value; // Not a string, so just return the value as-is
  };

  return Object.entries(envObject)
    .map(([key, value]) => `${key}=${escapeNewlines(value)}`)
    .join("\n");
}

async function afterInstall() {
  await lintDotenv();
}

async function deleteFiles(filesToBeDeleted) {
  const files = filesToBeDeleted;

  if (showLogs) console.log(`Deleting ${filesToBeDeleted}`);

  for (const bakFile of filesToBeDeleted) {
    await unlink(bakFile);
  }

  if (showLogs)
    console.log(`Deleted ${filesToBeDeleted.length} matching files.`);
}

async function getEnvBakFiles(directoryPath: string = outputFileDir) {
  try {
    const fileNames = await readdir(directoryPath); // returns a JS array of just short/local file-names, not paths.

    // Filter files that match the pattern ".env_*.bak"
    const filteredFileNames = fileNames.filter((fn) =>
      fn.match(/^\.env_.*\.bak$/),
    );

    const filePaths = filteredFileNames.map((fn) => join(directoryPath, fn));
    return filePaths;
  } catch (err) {
    if (showLogs) console.error(err);
    // depending on your application, this `catch` block (as-is) may be inappropriate;
    // consider instead, either not-catching and/or re-throwing a new Error with the previous err attached.
  }
}

async function main() {
  if (!existsSync(join(repoRoot, "bin", "dotenv-linter"))) {
    if (showLogs) console.log("dotenv-linter not found, installing...");
    await runCommand(
      `curl -sSfL https://git.io/JLbXn | sh -s -- -b ${join(repoRoot, "bin")}`,
    );
    await afterInstall();
  } else {
    if (showLogs)
      console.log(chalk.green(`Found: ${join("bin", "dotenv-linter")}`));
    await afterInstall();
  }
}

async function lintDotenv() {
  if (showLogs)
    console.log(
      chalk.green(
        `Running lint with fix on ${outputFileDir + outputFileName} file.`,
      ),
    );

  await runCommand(
    `${join(repoRoot, "bin", "dotenv-linter")} fix ${join(
      outputFileDir,
      outputFileName,
    )}`,
    true,
  );

  if (showLogs)
    console.log(chalk.green(`Linted ${outputFileDir + outputFileName} file.`));
  await deleteFiles(await getEnvBakFiles(outputFileDir));
}

writeFileSync(
  join(outputFileDir, outputFileName),
  await readAndParseEnvironment(),
);
if (showLogs)
  console.log(chalk.green(`Wrote ${outputFileDir + outputFileName} file.`));

main().catch((err) => {
  console.error(chalk.red(err));
  process.exit(1);
});
