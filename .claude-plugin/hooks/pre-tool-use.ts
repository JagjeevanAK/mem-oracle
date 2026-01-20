#!/usr/bin/env bun
// Pre-tool-use hook - can inject context before tool execution

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface HookOutput {
  // No modifications needed for pre-tool-use
}

async function main() {
  const input: HookInput = JSON.parse(await Bun.stdin.text());
  const output: HookOutput = {};

  // Currently no pre-tool-use actions needed
  // Future: could inject docs context for specific tools

  console.log(JSON.stringify(output));
}

main().catch(console.error);
