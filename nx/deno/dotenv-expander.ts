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
 *  --lint             Enable or disable linting of the output file (default: `true`).
 *
 * EXAMPLE:
 *  deno run --allow-read --allow-write --unstable script.ts -p DB,API -e ".config/.env .config/other.env" -l true -o .env.production --lint false
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

import { parse } from 'https://deno.land/std@0.204.0/flags/mod.ts';
import { existsSync } from 'https://deno.land/std@0.204.0/fs/mod.ts';
import { join } from 'https://deno.land/std@0.204.0/path/mod.ts';
import { ensureDir } from 'https://deno.land/std@0.206.0/fs/ensure_dir.ts';
import diff from 'https://deno.land/x/microdiff@v1.3.2/index.ts';
import { exit } from 'node:process';
import chalk from 'npm:chalk';
import { DotenvExpandOptions, DotenvExpandOutput, expand } from 'npm:dotenv-expand';
import Joi from 'npm:joi';
import * as yaml from 'npm:js-yaml';

/**
 * Parses command-line arguments.
 */
const args = parse(Deno.args, {
  string: ['p', 'prefixes', 'e', 'env', 'l', 'logs', 'o', 'output-file'],
  boolean: ['lint'], // Add a boolean option for linting
  alias: {
    p: 'prefixes',
    e: 'env',
    l: 'logs',
    o: 'output-file',
  },
  default: {
    logs: 'false',
    'output-file': '.env',
    lint: false,
  },
});

/** Environment variable prefixes. */
const prefixes = args.prefixes ? args.prefixes.split(' ').map((prefix: string) => prefix.trim()) : [];
/** Paths to environment variable files. */
const envPaths = args.env ? args.env.split(' ').map((envPath: string) => envPath.trim()) : [];
/** Override whether to show logs. */
const showLogs =
  Deno.env.get('DENO_ENV_EXPANDER_DEBUG')?.toLowerCase() === '1' ||
  Deno.env.get('DENO_ENV_EXPANDER_DEBUG')?.toLowerCase() === 'true' ||
  args.logs === 'true';
const doLint: boolean = args.lint;
/** Path to the output file. */
const outputFilePath = args['output-file'] || '.env';

const currentWorkingDirectory = Deno.cwd();
const dotenvLinterWorkspaceBinary = join(currentWorkingDirectory, 'bin', 'dotenv-linter');

interface IKeyValue {
  [key: string]: string | number | boolean | null;
}

function parseValue(value: string): string | number | boolean | null {
  // Convert to number if possible
  if (!isNaN(Number(value)) && value.trim() !== '') {
    return Number(value);
  }

  // Convert to boolean if possible
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // Convert to null or undefined
  if (value.toLowerCase() === 'null') {
    return null;
  }
  if (value.toLowerCase() === 'undefined') {
    return undefined;
  }

  // Fallback to string
  return value;
}

/**
 * Creates a memoized version of a function, caching the results of previous calls to optimize performance.
 *
 * @param {Function} fn - The function to be memoized.
 * @returns {Function} - The memoized version of the input function.
 *
 * @example
 * const expensiveCalculation = (a, b) => a + b;
 * const memoizedCalculation = memoize(expensiveCalculation);
 * memoizedCalculation(1, 2);  // Calculates result and caches it
 * memoizedCalculation(1, 2);  // Retrieves result from cache
 *
 * @description
 * The memoize function takes a function `fn` as an argument and returns a new function that caches the result of `fn`
 * for a given set of arguments. Subsequent calls to the memoized function with the same arguments will return the cached
 * result, avoiding the overhead of re-evaluating `fn`. The cache is implemented using a Map, with the stringified
 * arguments as the key.
 */
const memoize = (fn: Function) => {
  const cache = new Map();
  return (...args: any[]) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
};

/**
 * Executes a command in a safe manner.
 * @param {string[]} cmd - The command to execute as an array of strings.
 * @returns {Promise<boolean>} - A promise that resolves to true if the command executes successfully, false otherwise.
 */
async function runCommandSafe(cmd: string[]): Promise<boolean> {
  try {
    const process = Deno.run({ cmd });
    const status = await process.status();
    process.close();
    return status.success;
  } catch (error) {
    if (showLogs) console.error(`Error running command: ${cmd.join(' ')}`, error);
    return false;
  }
}

/**
 * Ensures that dotenv-linter is installed.
 * @returns {Promise<boolean>} - A promise that resolves to true if dotenv-linter is installed, false otherwise.
 */
async function ensureDotenvLinterInstalled(): Promise<boolean> {
  let fallbackToWorkspaceBin = false;

  // Log the beginning of the installation check process.
  log('Ensuring dotenv-linter is installed...');

  // Check if dotenv-linter is already available in the system's PATH.
  if (await isDotenvLinterInPath()) {
    log(chalk.green('dotenv-linter is already installed!'));
    return true;
  } else {
    log(chalk.yellow('dotenv-linter is not in the system path.'));
  }

  // Check if dotenv-linter is already installed within the project's bin directory.
  if (await isDotenvLinterBinaryInWorkspace()) {
    log(chalk.green('dotenv-linter is installed at ./bin/dotenv-linter ... will fallback to that!'));
    fallbackToWorkspaceBin = true;
    return true; // dotenv-linter is already installed in the workspace
  }

  // Attempt to install dotenv-linter using Cargo (Rust's package manager).
  log('Attempting install using cargo...');
  if (await isCargoAvailable()) {
    log('Installing dotenv-linter using cargo...');
    const success = await runCommandSafe(['sh', '-c', 'cargo install dotenv-linter --force']);

    if (!success || !(await isDotenvLinterInPath())) {
      throw new Error('Failed to install dotenv-linter using cargo. Falling back to another method.');
    } else {
      log(chalk.green('dotenv-linter installed successfully using cargo!'));
      return true;
    }
  }

  // If dotenv-linter is not found in PATH yet, attempt to install using a curl command.
  log('Attempting install using curl...');
  if (!(await isDotenvLinterBinaryInWorkspace())) {
    log('dotenv-linter not found, installing using curl...');
    await runCommandSafe(['sh', '-c', 'wget -q -O - https://git.io/JLbXn | sh -s -- -b ./bin/']);
    // Verify if dotenv-linter was successfully installed by the curl command.
    if (!(await isDotenvLinterBinaryInWorkspace())) {
      throw new Error('Failed to install dotenv-linter using curl.');
    }
    fallbackToWorkspaceBin = true;
  }

  // If the installation was successful using a fallback binary from the workspace, log the success.
  if (fallbackToWorkspaceBin) {
    log(chalk.green('dotenv-linter installed successfully using curl!'));
    return true;
  }

  // If the script reaches this point, dotenv-linter was not installed successfully.
  throw new Error('Failed to verify dotenv-linter installation.');
}

/**
 * Ensures that dotenv-linter is installed.
 * @returns {Promise<boolean>} - A promise that resolves to true if dotenv-linter is installed, false otherwise.
 */
async function isDotenvLinterInPath(): Promise<boolean> {
  return await runCommandSafe(['sh', '-c', 'dotenv-linter', '-v']);
}

/**
 * Checks if Cargo (Rust's package manager) is available.
 * @returns {Promise<boolean>} - A promise that resolves to true if Cargo is available, false otherwise.
 */
async function isCargoAvailable(): Promise<boolean> {
  return runCommandSafe(['sh', '-c', 'cargo', '-V']);
}

/**
 * Checks if dotenv-linter binary is available in the workspace.
 * @returns {Promise<boolean>} - A promise that resolves to true if dotenv-linter binary is in the workspace, false otherwise.
 */
async function isDotenvLinterBinaryInWorkspace(): Promise<boolean> {
  return existsSync(dotenvLinterWorkspaceBinary);
}

/**
 * Lints and auto-fixes a dotenv file at a specified file path.
 * Assumes `dotenv-linter` is installed. It runs the linter with the `fix` option.
 * Backup files generated by the linter are deleted post-linting.
 * @returns {Promise<void>} - A promise that resolves when linting and cleanup are complete.
 */
async function lintDotenv(): Promise<void> {
  if (showLogs) {
    console.log(chalk.green(`Running lint with fix on ${outputFilePath} file.`));
  }

  // Ensure that the command is properly formatted to use the local binary path for dotenv-linter
  let success;
  log(`Running command: ....`);
  if (await isDotenvLinterBinaryInWorkspace()) {
    log(`Using local binary ${dotenvLinterWorkspaceBinary} to fix ${currentWorkingDirectory}/${outputFilePath}`);
    log(`Running command: ${dotenvLinterWorkspaceBinary} fix ${outputFilePath} > /dev/null 2>&1`);
    success = await runCommandSafe(['sh', '-c', './bin/dotenv-linter fix ${outputFilePath} > /dev/null 2>&1']);
    log(`This.`)
  } else {
    log(`Using global binary dotenv-linter to fix ${currentWorkingDirectory}/${outputFilePath}`);
    log(`Running command: dotenv-linter fix ${outputFilePath} > /dev/null 2>&1`)
    success = await runCommandSafe([
      'sh',
      '-c',
      'dotenv-linter fix ${outputFilePath} > /dev/null 2>&1',
    ]);
    log(`That.`)

  }

  // Log the result of the linting process
  if (success) {
    if (showLogs) console.log(chalk.green(`Linted ${outputFilePath} file.`));
  } else {
    console.error(chalk.red(`Failed to lint ${outputFilePath} file.`));
  }

  // Get the list of backup files generated by dotenv-linter
  const backupFiles = await getEnvBakFiles(currentWorkingDirectory);

  // Delete the backup files
  await deleteFiles(backupFiles);
}

/**
 * Removes comments from a given string. Comments are considered as any text following a '#' symbol,
 * which is not preceded by a backslash.
 *
 * @param {string} str - The input string from which comments are to be removed.
 *
 * @returns {string} - A new string with all comments removed.
 *
 * @example
 * stripComments("some content # this is a comment"); // "some content"
 * stripComments("key=value # another comment here"); // "key=value"
 * stripComments("text with \\# not a comment # but this is a comment"); // "text with \\# not a comment"
 * stripComments("# a full comment line"); // ""
 * stripComments("multiple # comments # in a line"); // "multiple"
 * stripComments("escaped \\# hash symbol # and a comment"); // "escaped \\# hash symbol"
 * stripComments("#start with comment"); // ""
 */
export const stripComments = memoize((str: string): string => {
  const commentPattern = /(?<!\\)(?:^|\s)#.*$/gm;
  return str.replace(commentPattern, '').trim();
});

/**
 * Parses the content of a configuration file, filtering out comments and unnecessary whitespace.
 * @param {string} rawFileContent - The raw content of the configuration file.
 * @returns {IKeyValue} - An object mapping of key-value pairs from the file.
 */
export function parseAndFilterFileContent(rawFileContent: string): IKeyValue {
  const contentWithoutComments = stripComments(rawFileContent); // Using stripComments here
  const currentConfig: IKeyValue = {};

  contentWithoutComments.split('\n').forEach((line: string) => {
    line = line.replace(/\s*=\s*/, '=').trim();
    if (!line) return;

    const indexOfEquals = line.indexOf('=');
    if (indexOfEquals !== -1) {
      const key = line.substring(0, indexOfEquals).trim();
      const value = line.substring(indexOfEquals + 1).trim();
      currentConfig[key] = value;
    }
  });

  return currentConfig;
}

// Helper function to identify if a value is an escaped variable
function isEscapedVariable(value: string): boolean {
  // This assumes that escaped variables have a format like '\${VARIABLE_NAME}'.
  // Adjust the regex if the format is different.
  const escapedVariableRegex = /\\\${?[\w]+}?/g;
  return escapedVariableRegex.test(value);
}

interface VariableInfo {
  fullMatch: string;
  name: string;
  defaultValue: string;
}

/**
 * Extracts information about variables present within a string, using a regular expression to identify variable occurrences.
 * Each identified variable is represented by a `VariableInfo` object containing the full match, variable name, and default value if specified.
 *
 * @param {string} envValue - The string from which to extract variable information.
 *
 * @returns {VariableInfo[]} - An array of `VariableInfo` objects representing all identified variables within the string.
 */
function extractVariableInfo(envValue: string): VariableInfo[] {
  const regex = /(?<!\\)\${?([\w]+)(?::-([^}\\]*))?}?/g;
  const variables: VariableInfo[] = [];
  let match;
  while ((match = regex.exec(envValue))) {
    variables.push({
      fullMatch: match[0],
      name: match[1],
      defaultValue: match[2] || '',
    });
  }
  return variables;
}

/**
 * Identifies the names of variables within a string by leveraging the `extractVariableInfo` function to find variable occurrences,
 * then maps over the results to create an array of variable names.
 *
 * @param {string} envValue - The string containing potential variable references.
 *
 * @returns {string[]} - An array of distinct variable names identified within the string.
 */
export function identifyVariables(envValue: string): string[] {
  return extractVariableInfo(envValue).map((info) => info.name);
}

/**
 * Performs interpolation of variables within a string based on a provided configuration object.
 * Utilizes the `extractVariableInfo` function to identify variables, then replaces each variable occurrence with its corresponding value from the configuration object.
 * If a variable's value is not found within the configuration, it's replaced with a provided default value or remains unchanged.
 *
 * @param {string} envValue - The string containing variables to be interpolated.
 * @param {IKeyValue} config - The configuration object containing replacement values for variables.
 *
 * @returns {string} - The string with all identified variables interpolated based on the provided configuration.
 */
export function interpolate(envValue: string, config: IKeyValue): string {
  let result = envValue;
  extractVariableInfo(envValue).forEach((info) => {
    const replacementValue = config[info.name] || info.defaultValue;
    result = result.replace(info.fullMatch, replacementValue);
  });
  return result;
}

/**
 * Performs a topological sort on a configuration object to order the keys based on their dependency relationships.
 *
 * @param {IKeyValue} config - The configuration object containing key-value pairs.
 *
 * @returns {IKeyValue} - A new configuration object with keys ordered based on their dependencies.
 *
 * @throws {Error} Throws an error if a cyclic dependency is detected among the keys.
 *
 * @description
 * The function builds a graph representation of the dependencies among the keys in the configuration object,
 * then performs a topological sort on this graph to order the keys. If a cyclic dependency is detected, an error is thrown.
 */
function topologySort(config: IKeyValue): IKeyValue {
  const graph = new Map<string, string[]>();
  const result: string[] = [];

  // Build the graph
  Object.keys(config).forEach((key) => {
    if (typeof config[key] === 'string') {
      graph.set(
        key,
        extractVariableInfo(config[key] as string).map((info) => info.name),
      );
    } else {
      // For non-string values, we assume no dependencies
      graph.set(key, []);
    }
  });

  function visit(node: string, ancestors: Set<string> = new Set()): void {
    if (!graph.has(node)) return;

    if (ancestors.has(node)) {
      throw new Error('Cyclic dependency detected');
    }

    ancestors.add(node);
    const children = graph.get(node);
    graph.delete(node); // Mark as visited
    children?.forEach((child) => visit(child, ancestors));
    ancestors.delete(node);

    result.push(node);
  }

  while (graph.size > 0) {
    visit(Array.from(graph.keys())[0]);
  }

  return result.reduce((acc: IKeyValue, key) => {
    acc[key] = config[key];
    return acc;
  }, {});
}

/**
 * Wraps the `topologySort` function to handle errors and log them to the console.
 *
 * @param {IKeyValue} config - The configuration object to be sorted.
 *
 * @returns {IKeyValue} - A new configuration object with properties sorted by dependency, or the original object if an error occurs.
 *
 * @description
 * This function attempts to perform a topological sort on the provided configuration object using `topologySort`.
 * If a cyclic dependency is detected and an error is thrown, it logs the error message to the console and returns the original configuration object.
 */
export function sortByDependencyTree(config: IKeyValue): IKeyValue {
  try {
    return topologySort(config);
  } catch (e) {
    console.error('Error sorting config:', e.message);
    return config; // Return original config if sort fails
  }
}

/**
 * Expands variables within a string using values from a provided configuration object.
 * Additionally, resolves any escape sequences present within the string.
 *
 * @param {string} value - The string containing variables to be expanded.
 * @param {IKeyValue} config - The configuration object containing replacement values for variables.
 *
 * @returns {string} - The string with all variables expanded and escape sequences resolved.
 */
export function expandValue(value: string, config: IKeyValue): string {
  return resolveEscapeSequences(interpolate(value, config));
}

/**
 * Replaces escaped dollar signs within a string, facilitating the accurate representation of dollar signs within interpolated strings.
 *
 * The function employs a regular expression to search for occurrences of escaped dollar signs (`\$`). Each match is then replaced
 * with an unescaped dollar sign (`$`), ensuring that dollar signs intended to be literals are not mistaken as variable indicators
 * in string interpolation processes.
 *
 * @param {string} value - The string in which escape sequences need to be resolved.
 *
 * @returns {string} - A new string with all instances of escaped dollar signs replaced by unescaped dollar signs.
 */
export function resolveEscapeSequences(value: string): string {
  return value.replace(/\\\$/g, '$');
}

/**
 * Logs a message to the console if logging is enabled.
 * @param {string} message - The message to be logged.
 */
export function log(message: string) {
  showLogs ? console.log(message) : undefined;
}

/**
 * Logs a separator line to the console if logging is enabled, providing visual separation in logged output.
 */
export function logSeparator() {
  log('');
  log('---------------------------------------------------------------------------------------');
  log('');
}

/**
 * Reads the content of an environment file and validates its existence.
 * @param {string} envPath - The path to the environment file.
 * @returns {Promise<string>} - A promise that resolves with the file content.
 * @throws {Error} - Throws an error if the file does not exist.
 */
async function readAndValidateEnvFile(envPath: string): Promise<string> {
  if (!existsSync(envPath)) {
    throw new Error(`.env file at path ${envPath} does not exist.`);
  }
  return await Deno.readTextFile(envPath);
}

/**
 * Merges and expands configurations from provided file paths, resolving environment variables within configurations.
 *
 * This function processes each configuration file specified in the `envPaths` array. It reads, parses, and merges the configurations,
 * sorting them based on their dependencies. It then uses dotenv-expand to handle the expansion of variables within each configuration.
 * The merged and expanded configurations are then cleaned to ensure proper formatting. The function supports logging the intermediate
 * and final states of the configuration for debugging purposes. The output is a consolidated configuration object that combines and resolves
 * all variables from the provided files.
 *
 * @param {string[]} envPaths - An array of file paths containing environment configurations.
 *
 * @returns {Promise<IKeyValue>} - A promise that resolves with the merged and expanded configuration object.
 *
 * @throws {Error} Throws an error if a file at a given path does not exist or if there is an issue during the reading, parsing, or expanding process.
 */
export async function mergeAndExpandConfigs(envPaths: string[]): Promise<IKeyValue> {
  let config: IKeyValue = {};

  // read in all files and merge them before anything else
  for (const envPath of envPaths) {
    const rawFileContent = await readAndValidateEnvFile(envPath);
    const currentConfig = parseAndFilterFileContent(rawFileContent);
    config = {
      ...config,
      ...currentConfig,
    };
  }

  // sort the merged configuration based on their dependencies
  config = sortByDependencyTree(config);

  if (showLogs) {
    // write the sorted config to a file
    const preExpansionYaml = yaml.dump(config);
    writeFile('tmp/dotenv/sorted.config.pre.yaml', preExpansionYaml);
  }

  // use dotenv-expand to handle variable expansions
  const mergedForExpand: DotenvExpandOptions = {
    parsed: { ...config },
  };
  const expandedConfig: DotenvExpandOutput = expand(mergedForExpand);

  config = expandedConfig.parsed || {};

  let typedConfig = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, parseValue(value as string)]),
  );

  // output what the final config looks like after expansion but BEFORE cleaning
  if (showLogs) {
    // Create a structured object for YAML output
    const yamlOutput = Object.fromEntries(
      Object.entries(typedConfig).map(([key, value]) => [key, [{ type: typeof value, value: value }]]),
    );

    // Serialize the structured object to YAML
    const yamlContent = yaml.dump(yamlOutput);

    // Write the YAML content to a file
    await writeFile('tmp/dotenv/sorted.config.post.dirty.yaml', yamlContent);
  }

  typedConfig = cleanTypedConfigValues(typedConfig); // clean the config

  // output what the final config looks like after expansion and AFTER cleaning
  if (showLogs) {
    // Create a structured object for YAML output
    const yamlOutput = Object.fromEntries(
      Object.entries(typedConfig).map(([key, value]) => [
        key,
        [{ type: typeof value, value: typeof value === 'string' ? stripWrappingQuotes(value) : value }],
      ]),
    );

    // Serialize the structured object to YAML
    const yamlContent = yaml.dump(yamlOutput);

    // Write the YAML content to a file
    await writeFile('tmp/dotenv/sorted.config.post.clean.yaml', yamlContent);
  }

  return typedConfig;
}

/**
 * Removes wrapping quotes from a string if present.
 *
 * This function checks if a string starts and ends with either double quotes ("") or single quotes ('').
 * If it does, these quotes are stripped from both ends of the string. This process is repeated as long as the string
 * is wrapped in quotes, effectively removing nested quotes as well.
 *
 * @param {string} value - The string from which wrapping quotes should be removed.
 * @returns {string} - The string with wrapping quotes removed.
 */
function stripWrappingQuotes(value: string): string {
  while ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.substring(1, value.length - 1);
  }
  return value;
}

/**
 * Wraps a given string with quotes if needed based on its content.
 *
 * This function analyzes the string and decides whether to wrap it with single or double quotes.
 * It wraps the string in double quotes if it is multiline. If the string contains a hash (`#`)
 * or special characters, it is wrapped in single quotes. Otherwise, the string is wrapped in double quotes by default.
 *
 * @param {string} str - The string to be wrapped.
 * @returns {string} - The wrapped string with appropriate quotes.
 */
function wrapValueIfNeeded(str: string): string {
  // Check for multiline strings
  if (str.includes('\\n')) {
    return `"${str}"`;
  }

  // Check for hash or special characters
  const specialCharRegex = /[^a-zA-Z0-9 _-]/;
  if (str.includes('#') || specialCharRegex.test(str)) {
    return `'${str}'`;
  }

  // Default to wrapping with double quotes
  return `"${str}"`;
}

/**
 * Cleans the values in a given configuration object.
 *
 * This function iterates over each key-value pair in the configuration object. If a value is a string,
 * it removes any wrapping quotes from the value. This is typically used to clean up parsed configuration values.
 *
 * @param {IKeyValue} config - The configuration object with key-value pairs to be cleaned.
 * @returns {IKeyValue} - The cleaned configuration object.
 */
function cleanTypedConfigValues(config: IKeyValue): IKeyValue {
  // clean the config values
  Object.entries(config).forEach(([key, value]) => {
    if (typeof value === 'string') {
      value = stripWrappingQuotes(value);
      config[key] = value;
    }
  });

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
export function writeFile(filePath: string, content: string): void {
  try {
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/')); // extract the directory path from the file path
    ensureDir(dirPath); // ensure that the directory exists
    Deno.writeTextFile(filePath, content);
    log(`Expanded environment variables written to: ${filePath}`);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Checks if a file exists at the specified file path.
 *
 * @param filePath - The path to the file.
 * @returns A promise that resolves to true if the file exists, false otherwise.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await Deno.lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Removes a file if it exists at the specified file path.
 *
 * @param filePath - The path to the file.
 */
async function removeFile(filePath: string): Promise<void> {
  const exists = await fileExists(filePath);
  if (exists) {
    await Deno.remove(filePath);
    console.log(`Removed ${filePath}`);
  } else {
    console.log(`${filePath} does not exist`);
  }
}

/**
 * Deletes the specified files from the filesystem.
 *
 * @param filesToBeDeleted - An array of file paths to be deleted.
 */
async function deleteFiles(filesToBeDeleted: string[]): Promise<void> {
  const files = filesToBeDeleted;

  if (showLogs) console.log(`Deleting ${filesToBeDeleted}`);

  // Use a Promise.all to initiate all deletions concurrently, which can be more efficient than awaiting each deletion in sequence
  await Promise.all(filesToBeDeleted.map((file) => removeFile(file)));

  if (showLogs) console.log(`Deleted ${filesToBeDeleted.length} matching files.`);
}

/**
 * Retrieves the paths of backup files generated by dotenv-linter in a specified directory.
 *
 * @param directoryPath - The path to the directory to search for backup files. Defaults to the directory of the output file.
 * @returns A promise that resolves to an array of file paths.
 */
async function getEnvBakFiles(directoryPath: string = outputFilePath): Promise<string[]> {
  try {
    const dirEntries: Deno.DirEntry[] = [];
    for await (const dirEntry of Deno.readDir(directoryPath)) {
      dirEntries.push(dirEntry);
    }

    // Convert DirEntry objects to file names
    const fileNames = dirEntries.filter((entry) => entry.isFile).map((entry) => entry.name);

    // Filter files that match the pattern ".env_*.bak"
    const filteredFileNames = fileNames.filter((fn) => fn.match(/^\.env_.*\.bak$/));

    // Map file names to full file paths
    const filePaths = filteredFileNames.map((fn) => join(directoryPath, fn));

    return filePaths;
  } catch (err) {
    if (showLogs) console.error(`Error while getting backup files: ${err.message}`);
    // Re-throwing the error to be handled by the calling function
    throw new Error(`Failed to get backup files: ${err.message}`);
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
  // remove any existing .env file
  await removeFile('.env');
  // ensure dotenv-linter is installed
  await ensureDotenvLinterInstalled();

  // let's process the .env files and output the result to .env
  try {
    envPaths.forEach((path: string) => checkFileExistence(path));

    let config = await mergeAndExpandConfigs(envPaths); // Don't forget to await here

    // Filter by prefix only if there are prefixes specified
    if (prefixes.length) {
      config = Object.fromEntries(
        Object.entries(config).filter(([key]) => prefixes.some((prefix: string) => key.startsWith(prefix))),
      );
    }

    await writeFile(
      outputFilePath,
      Object.entries(config)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => `${key}=${typeof value === 'string' ? wrapValueIfNeeded(value) : value}`)
      .join('\n'),
    );

    log('Operation completed.');
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }

  // let's lint the .env file
  if (doLint) {
    await lintDotenv();
  }
}

if (import.meta.main) {
  main();
}
