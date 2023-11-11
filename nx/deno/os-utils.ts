/**
 * **System Info Display Utility**
 *
 * This script provides information about the system and Deno environment. It can display the following types of information:
 *
 * - End of Line Character used by the operating system.
 * - Operating System Architecture.
 * - Number of Logical CPUs available.
 * - Memory Information (Total, Free, and Available) if available.
 *
 * **Usage Instructions:**
 * To clear your cache for testing this script, run the following command:
 * ```
 * deno cache --reload https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts
 * ```
 *
 * @module os-utils
 *
 * @example
 * // Example usage in a Deno environment:
 *
 * // Display the End of Line character used by the operating system:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts eol
 *
 * // Display the Operating System Architecture:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts arch
 *
 * // Display the Number of Logical CPUs available:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts cpus
 *
 * // Display Memory Information:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts memory
 *
 * // Display Memory Information (Free Memory):
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts memory --index 1
 *
 * // Display Memory Information (Available Memory):
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts memory --index 2
 *
 * // Display Memory Information in "value-only" mode:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts memory --value
 *
 * // Display Memory Information (Free Memory) in "value-only" mode:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts memory --index 1 --value
 *
 * // Display file information:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts fileinfo /path/to/your/file.txt
 *
 * // Display file information with last modified timestamp in milliseconds:
 * deno run -A https://raw.githubusercontent.com/snydertechnologies/dev-utils/main/nx/deno/os-utils.ts fileinfo /path/to/your/file.txt --last-modified-ms
 */
import { EOL } from "https://deno.land/std/fs/eol.ts";

const endOfLine = Deno.build.os === "windows" ? EOL.CRLF : EOL.LF;
const architecture = Deno.build.arch;
const logicalCPUs = navigator.hardwareConcurrency;
const memoryInfo = Deno.systemMemoryInfo ? Deno.systemMemoryInfo() : null;

function displayInfo(infoType: string, valueOnly: boolean, index?: number) {
  let output;
  switch (infoType) {
    case "eol":
      output = `End of Line Character: ${endOfLine}`;
      break;
    case "arch":
      output = `OS Architecture: ${architecture}`;
      break;
    case "cpus":
      output = `Logical CPUs: ${logicalCPUs}`;
      break;
    case "memory":
      if (memoryInfo) {
        const memoryDetails = [
          `Total Memory: ${memoryInfo.total}`,
          `Free Memory: ${memoryInfo.free}`,
          `Available Memory: ${memoryInfo.available}`,
        ];
        output =
          index !== undefined ? memoryDetails[index] : memoryDetails.join("\n");
      } else {
        output = "Memory info is not available.";
      }
      break;
    default:
      output = "Please provide a valid argument: eol, arch, cpus, or memory";
      break;
  }

  if (valueOnly) {
    console.log(output.split(": ")[1]);
  } else {
    console.log(output);
  }
}

async function displayFileInfo(filePath: string, lastModifiedMs: boolean) {
  try {
    const fileInfo = await Deno.stat(filePath);
    if (lastModifiedMs) {
      const now = new Date().getTime();
      const diffMs = now - fileInfo.mtime!.getTime();
      console.log(diffMs);
    } else {
      console.log(`File Info for ${filePath}:`);
      console.log(`Created: ${fileInfo.birthtime}`);
      console.log(`Last Modified: ${fileInfo.mtime}`);
      console.log(`Size: ${fileInfo.size} bytes`);
    }
  } catch (err) {
    console.error(`Error reading file info for ${filePath}:`, err.message);
  }
}

const args = Deno.args;
if (args.length) {
  const infoType = args[0];
  const valueOnly = args.includes("-v") || args.includes("--value");
  const indexArg = args.includes("--index") ? args.indexOf("--index") + 1 : -1;
  const index = indexArg >= 0 ? parseInt(args[indexArg], 10) : undefined;

  if (infoType === "fileinfo") {
    const filePath = args[1]; // assuming the file path is provided right after "fileinfo"
    const lastModifiedMs = args.includes("--last-modified-ms");
    displayFileInfo(filePath, lastModifiedMs);
  } else {
    displayInfo(infoType, valueOnly, index);
  }
} else {
  console.log(
    "Please provide an argument: eol, arch, cpus, memory, or fileinfo",
  );
}
