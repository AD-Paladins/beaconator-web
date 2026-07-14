#!/usr/bin/env node
/**
 * setup-opencode-models.js
 *
 * Configures OpenCode Zen free models for Gentle AI SDD agents.
 *
 * Models assigned (by ranking):
 *   1. DeepSeek V4 Flash Free — orchestrator, heavy SDD phases, root model
 *   2. MiMo-V2.5 Free         — review agents, judgment day judges
 *   3. Nemotron 3 Ultra Free  — lighter SDD phases
 *
 * Requirements:
 *   - OpenCode installed
 *   - Gentle AI installed (agents defined in opencode.json)
 *   - OpenCode Zen connected (run /connect in TUI, select OpenCode Zen, paste API key)
 *
 * Usage:
 *   node setup-opencode-models.js              # apply config
 *   node setup-opencode-models.js --dry-run    # preview changes without writing
 *
 * Safe to run multiple times. Preserves all existing config (prompts, tools, permissions, etc.).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const CONFIG_FILE = path.join(CONFIG_DIR, 'opencode.json');

// ── Model IDs ────────────────────────────────────────────────────────
const DEEPSEEK = 'opencode/deepseek-v4-flash-free';
const MIMO     = 'opencode/mimo-v2.5-free';
const NEMOTRON = 'opencode/nemotron-3-ultra-free';

// ── Agent → Model mapping ────────────────────────────────────────────
const HEAVY_SDD = [
  'gentle-orchestrator',   // coordinator — needs strongest model
  'sdd-apply',             // code implementation
  'sdd-design',            // technical architecture
  'sdd-spec',              // specification writing
  'sdd-tasks',             // task breakdown
  'jd-fix-agent',          // judgment day surgical fixes
];

const REVIEW_AGENTS = [
  'jd-judge-a',            // blind adversarial judge A
  'jd-judge-b',            // blind adversarial judge B
  'review-readability',    // R2 — naming, complexity, maintainability
  'review-refuter',        // batched adversarial refuter
  'review-reliability',    // R3 — behavior, tests, edge cases
  'review-resilience',     // R4 — fallbacks, retry, degradation
  'review-risk',           // R1 — security, permissions, data exposure
];

const LIGHT_SDD = [
  'sdd-explore',           // codebase investigation
  'sdd-propose',           // change proposals
  'sdd-init',              // project bootstrap
  'sdd-archive',           // artifact archival
  'sdd-verify',            // spec compliance validation
  'sdd-onboard',           // guided SDD walkthrough
];

// ── Read existing config or create minimal structure ─────────────────
let config;

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log(`✓ Found existing config: ${CONFIG_FILE}`);
  } catch (err) {
    console.error(`✗ Failed to parse ${CONFIG_FILE}: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log(`⚠ No opencode.json found at ${CONFIG_FILE}`);
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    console.log(`✓ Created config directory: ${CONFIG_DIR}`);
  }
  config = {
    $schema: 'opencode.ai',
    agent: {},
    default_agent: 'gentle-orchestrator',
    model: DEEPSEEK,
  };
  console.log('✓ Created minimal config structure');
}

// ── Ensure agent object exists ───────────────────────────────────────
if (!config.agent) config.agent = {};

// ── Apply model assignments ──────────────────────────────────────────
let changed = 0;
let missing = 0;

function assignModel(agents, model) {
  for (const name of agents) {
    if (!config.agent[name]) {
      console.log(`  ⚠ Agent "${name}" not found in config — skipping (run Gentle AI installer first)`);
      missing++;
      continue;
    }
    const prev = config.agent[name].model;
    config.agent[name].model = model;
    if (prev !== model) {
      console.log(`  ${prev ? '↻' : '+'} ${name} → ${model}`);
      changed++;
    } else {
      console.log(`  ✓ ${name} (already set)`);
    }
  }
}

console.log('\n── DeepSeek V4 Flash Free (heavy SDD + orchestrator) ──');
assignModel(HEAVY_SDD, DEEPSEEK);

console.log('\n── MiMo-V2.5 Free (review + judgment day) ──');
assignModel(REVIEW_AGENTS, MIMO);

console.log('\n── Nemotron 3 Ultra Free (lighter SDD phases) ──');
assignModel(LIGHT_SDD, NEMOTRON);

// ── Set root model ───────────────────────────────────────────────────
const prevRoot = config.model;
config.model = DEEPSEEK;
if (prevRoot !== DEEPSEEK) {
  console.log(`\n  ${prevRoot ? '↻' : '+'} Root model → ${DEEPSEEK}`);
  changed++;
} else {
  console.log(`\n  ✓ Root model (already set)`);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n── Summary ──`);
console.log(`  Changed: ${changed} | Already set: ${Object.keys(config.agent).length - missing - changed} | Missing agents: ${missing}`);

if (missing > 0) {
  console.log(`\n  ⚠ ${missing} agent(s) not found. Make sure Gentle AI is installed:`);
  console.log(`    1. Install Gentle AI (opencode plugin or manual setup)`);
  console.log(`    2. Re-run this script`);
}

// ── Write config ─────────────────────────────────────────────────────
if (DRY_RUN) {
  console.log(`\n── Dry run — no changes written ──`);
  console.log(`  Would write to: ${CONFIG_FILE}`);
} else {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n✓ Config written to: ${CONFIG_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Restart OpenCode to pick up the new config`);
  console.log(`  2. Verify with /models in the TUI`);
  console.log(`  3. Test with: /sdd-explore <topic>`);
}
