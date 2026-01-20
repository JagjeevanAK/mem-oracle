#!/usr/bin/env bun
// Session end hook - cleanup or persistence tasks

interface HookInput {
  session_id?: string;
}

interface HookOutput {
  // No modifications needed for session-end
}

async function main() {
  const input: HookInput = JSON.parse(await Bun.stdin.text());
  const output: HookOutput = {};

  // Currently no session-end actions needed
  // Future: could save session context or trigger background tasks

  console.log(JSON.stringify(output));
}

main().catch(console.error);
