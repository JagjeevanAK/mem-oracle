#!/usr/bin/env bun
// Post-tool-use hook - can capture tool results for context

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: string;
}

interface HookOutput {
  // No modifications needed for post-tool-use
}

async function main() {
  const input: HookInput = JSON.parse(await Bun.stdin.text());
  const output: HookOutput = {};

  // Currently no post-tool-use actions needed
  // Future: could index code context or capture patterns

  console.log(JSON.stringify(output));
}

main().catch(console.error);
