#!/usr/bin/env bun

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface HookOutput {
  decision?: "allow" | "block";
  reason?: string;
}

async function main() {
  const _input: HookInput = JSON.parse(await Bun.stdin.text());
  const output: HookOutput = { decision: "allow" };
  console.log(JSON.stringify(output));
}

main().catch(console.error);
