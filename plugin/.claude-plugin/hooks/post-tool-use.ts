#!/usr/bin/env bun

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
}

interface HookOutput {
  context?: string;
}

async function main() {
  const _input: HookInput = JSON.parse(await Bun.stdin.text());
  const output: HookOutput = {};
  console.log(JSON.stringify(output));
}

main().catch(console.error);
