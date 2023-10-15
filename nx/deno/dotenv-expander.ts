/**
 * Environment Variable Expander for Deno
 *
 * This script processes and merges multiple configuration files, expanding referenced
 * environment variables and writes the consolidated configuration to an output file.
 *
 * USAGE:
 *  deno run --allow-read --allow-write --unstable script.ts [OPTIONS]
 *
 * OPTIONS:
 *  -p, --prefixes     Comma-separated prefixes to identify environment variables for expansion.
 *  -e, --env          Space-separated paths to the input configuration files.
 *  -l, --logs         Enable or disable logs (default: `false`).
 *  -o, --output-file  Path to the output configuration file (default: `.env`).
 *
 * EXAMPLE:
 *  deno run --allow-read --allow-write --unstable script.ts -p DB,API -e ".config/.env .config/other.env" -l true -o .env.production
 *
 * INSTALLATION:
 *  Install Deno using:
 *    curl -fsSL https://deno.land/x/install/install.sh | sh
 *
 * PERMISSIONS:
 *  The script requires permissions to read and write files. Utilize --allow-read and --allow-write flags.
 *
 * SECURITY NOTE:
 *  Ensure sensitive data is handled securely, as environment variables might be written to an output file.
 */

import { parse } from "https://deno.land/std@0.204.0/flags/mod.ts";
import { existsSync } from "https://deno.land/std@0.204.0/fs/mod.ts";

/**
 * Parses command-line arguments.
 */
const args = parse(Deno.args, {
  string: ["p", "prefixes", "e", "env", "l", "logs", "o", "output-file"],
  alias: {
    p: "prefixes",
    e: "env",
    l: "logs",
    o: "output-file",
  },
  default: {
    logs: "false",
    "output-file": ".env",
  },
});

/** Environment variable prefixes. */
const prefixes = args.prefixes
  ? args.prefixes.split(" ").map((prefix: string) => prefix.trim())
  : [];
/** Paths to environment variable files. */
const envPaths = args.env
  ? args.env.split(" ").map((envPath: string) => envPath.trim())
  : [];
/** Override whether to show logs. */
const showLogs =
  Deno.env.get("DENU_ENV_EXPANDER_DEBUG")?.toLowerCase() === "1" ||
  Deno.env.get("DENU_ENV_EXPANDER_DEBUG")?.toLowerCase() === "true" ||
  args.logs === "true";
/** Path to the output file. */
const outputFilePath = args["output-file"];

/**
 * Reads the content of an environment file and validates its existence.
 * @param {string} envPath - The path to the environment file.
 * @returns {Promise<string>} - A promise that resolves with the file content.
 * @throws Will throw an error if the file does not exist.
 */
async function readAndValidateEnvFile(envPath: string): Promise<string> {
  if (!existsSync(envPath)) {
    throw new Error(`.env file at path ${envPath} does not exist.`);
  }
  return await Deno.readTextFile(envPath);
}

/**
 * Parses and filters the content of a configuration file.
 * Ignores comment lines and trims unnecessary whitespace.
 * @param {string} rawFileContent - The raw content of the configuration file.
 * @returns {{ [key: string]: string }} - An object mapping of key-value pairs from the file.
 */
function parseAndFilterFileContent(rawFileContent: string): {
  [key: string]: string;
} {
  const currentConfig: { [key: string]: string } = {};
  rawFileContent.split("\n").forEach((line) => {
    line = line.replace(/\s*=\s*/, "=").trim();
    if (!line || line.startsWith("#")) return;

    const indexOfEquals = line.indexOf("=");
    if (indexOfEquals !== -1) {
      const key = line.substring(0, indexOfEquals).trim();
      const value = line.substring(indexOfEquals + 1).trim();
      currentConfig[key] = value;
    }
  });
  return currentConfig;
}

/**
 * Expands environment variables in the provided configuration object.
 * @param {{ [key: string]: string }} currentConfig - The current configuration to be expanded.
 * @param {{ [key: string]: string }} baseConfig - The base configuration used for variable expansion.
 * @returns {{ [key: string]: string }} - The expanded configuration object.
 */
function expandEnvVariablesInConfig(
  currentConfig: { [key: string]: string },
  baseConfig: { [key: string]: string },
): { [key: string]: string } {
  for (const key in currentConfig) {
    currentConfig[key] = expandValue(currentConfig[key], {
      ...baseConfig,
      ...currentConfig,
    });
  }
  return currentConfig;
}

/**
 * Searches for the last occurrence of a regex pattern in a string.
 * @param {string} str - The string to search within.
 * @param {RegExp} rgx - The regex pattern to search for.
 * @returns {number} - The index of the last occurrence of the pattern. Returns -1 if not found.
 */
function searchLast(str: string, rgx: RegExp): number {
  const matches = Array.from(str.matchAll(rgx));
  if (matches.length === 0) return -1;

  const lastIndex = matches.slice(-1)[0].index;
  return lastIndex !== undefined ? lastIndex : -1;
}

/**
 * Interpolates the values in the provided string with corresponding values from the configuration.
 * @param {string} envValue - The value to be interpolated.
 * @param {{ [key: string]: string }} config - The configuration containing values for interpolation.
 * @returns {string} - The interpolated string.
 */
function interpolate(
  envValue: string,
  config: { [key: string]: string },
): string {
  const lastUnescapedDollarSignIndex = searchLast(envValue, /(?<!\\)\$/g);

  if (lastUnescapedDollarSignIndex === -1) return envValue;

  const rightMostGroup = envValue.slice(lastUnescapedDollarSignIndex);

  const matchGroup = /((?<!\\)\${?([\w]+)(?::-([^}\\]*))?}?)/;
  const match = rightMostGroup.match(matchGroup);

  if (match != null) {
    const [, group, variableName, defaultValue] = match;

    return interpolate(
      envValue.replace(group, config[variableName] || defaultValue || ""),
      config,
    );
  }

  return envValue;
}

/**
 * Resolves escape sequences in the given string. Specifically, it replaces escaped dollar signs.
 * @param {string} value - The string containing escape sequences.
 * @returns {string} - The string with resolved escape sequences.
 */
function resolveEscapeSequences(value: string): string {
  return value.replace(/\\\$/g, "$");
}

/**
 * Expands the values in the provided string using values from the given configuration.
 * This function also resolves any escape sequences present.
 * @param {string} value - The value to be expanded.
 * @param {{ [key: string]: string }} config - The configuration to use for expansion.
 * @returns {string} - The expanded string.
 */
export function expandValue(
  value: string,
  config: { [key: string]: string },
): string {
  return resolveEscapeSequences(interpolate(value, config));
}

/**
 * Logs a message to the console if logging is enabled.
 * @param {string} message - The message to be logged.
 */
function log(message: string) {
  showLogs ? console.log(message) : undefined;
}

/**
 * Logs a separator to the console if logging is enabled.
 * @param {string} message - The message to be logged.
 */
function logSeparator() {
  log("");
  log(
    "---------------------------------------------------------------------------------------",
  );
  log("");
}

/**
 * Merges and expands configurations from provided file paths.
 * @param {string[]} envPaths - An array of file paths containing environment configurations.
 * @param {{ [key: string]: string }} baseConfig - (Optional) A base configuration to merge with and expand upon.
 * @returns {Promise<{ [key: string]: string }>} - A promise that resolves with the merged and expanded configuration.
 */
export async function mergeAndExpandConfigs(
  envPaths: string[],
  baseConfig: { [key: string]: string } = {},
): Promise<{ [key: string]: string }> {
  let config = { ...baseConfig };

  for (const envPath of envPaths) {
    const rawFileContent = await readAndValidateEnvFile(envPath);
    let currentConfig = parseAndFilterFileContent(rawFileContent);
    config = {
      ...config,
      ...expandEnvVariablesInConfig(currentConfig, config),
    };
  }

  return config;
}

/**
 * Checks the existence of a file at a given path.
 * @param {string} path - The path to check.
 * @throws Will throw an error if the file does not exist.
 */
export function checkFileExistence(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`File at path ${path} does not exist.`);
  }
}

/**
 * Writes a string content to a specified file path.
 * @param {string} filePath - The path where the content will be written.
 * @param {string} content - The content to write.
 * @returns {Promise<void>} - A promise indicating the completion of the write operation.
 */
export async function writeFile(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await Deno.writeTextFile(filePath, content);
    log(`Expanded environment variables written to: ${filePath}`);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Main function orchestrating the script flow:
 * 1. Validates file existence.
 * 2. Merges and expands configurations.
 * 3. Writes the resulting configuration to the output file.
 * Handles errors gracefully and logs the operation steps if logging is enabled.
 */
async function main() {
  try {
    envPaths.forEach((path: string) => checkFileExistence(path));

    let config = await mergeAndExpandConfigs(envPaths); // Don't forget to await here

    // Filter by prefix only if there are prefixes specified
    if (prefixes.length) {
      config = Object.fromEntries(
        Object.entries(config).filter(([key]) =>
          prefixes.some((prefix: string) => key.startsWith(prefix)),
        ),
      );
    }

    await writeFile(
      outputFilePath,
      Object.entries(config)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );

    log("Operation completed.");
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}

main();
