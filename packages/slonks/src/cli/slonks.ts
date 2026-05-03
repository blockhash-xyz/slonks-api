#!/usr/bin/env bun

import { runSlopPlanner } from "./slopPlanner.ts";
import { runGlobalL1 } from "./globalL1.ts";

type Command = {
  description: string;
  run: (argv: string[]) => Promise<void>;
};

const COMMANDS: Record<string, Command> = {
  plan: {
    description: "Find high-slop merge paths for a holder",
    run: runSlopPlanner,
  },
  "global-l1": {
    description: "Check every one-level merge between unmerged tokens",
    run: runGlobalL1,
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || isHelp(command)) {
    usage();
    return;
  }

  if (command === "--version" || command === "-v") {
    await version();
    return;
  }

  if (command === "help") {
    await help(argv[1]);
    return;
  }

  const entry = COMMANDS[command];
  if (entry) {
    await entry.run(argv.slice(1));
    return;
  }

  if (command === "slop" && argv[1] === "plan") {
    await runSlopPlanner(argv.slice(2));
    return;
  }

  if (command.startsWith("--")) {
    await runSlopPlanner(argv);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("");
  usage();
  process.exit(1);
}

async function help(command: string | undefined): Promise<void> {
  if (!command) {
    usage();
    return;
  }
  const entry = COMMANDS[command];
  if (!entry) throw new Error(`unknown command ${command}`);
  await entry.run(["--help"]);
}

async function version(): Promise<void> {
  const packageJson = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as { version: string };
  console.log(`slonks ${packageJson.version}`);
}

function isHelp(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

function usage() {
  const commandHelp = Object.entries(COMMANDS)
    .map(([name, entry]) => `  ${name.padEnd(9)} ${entry.description}`)
    .join("\n");

  console.log(`Usage:
  slonks <command> [options]
  slonks --owner 0x... [plan options]

Commands:
${commandHelp}

Run "slonks <command> --help" for command options.
Run "slonks help <command>" for the same command help.
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
