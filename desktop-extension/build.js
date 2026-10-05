#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Rurimpa (https://github.com/Rurimpa/caas)
// SPDX-License-Identifier: MIT
/*
 * build.js - packs the CAAS gate as a Claude Desktop extension (caas-gate.mcpb).
 *   node desktop-extension/build.js
 * Copies code/gate/caas_gate.js unchanged into a staging folder next to start.js and manifest.json,
 * then runs `npx @anthropic-ai/mcpb pack`. The gate keeps one source (code/gate/caas_gate.js).
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'caas-mcpb-'));
fs.mkdirSync(path.join(stage, 'server'));
fs.copyFileSync(path.join(here, 'manifest.json'), path.join(stage, 'manifest.json'));
fs.copyFileSync(path.join(here, 'server', 'start.js'), path.join(stage, 'server', 'start.js'));
fs.copyFileSync(path.join(here, '..', 'code', 'gate', 'caas_gate.js'), path.join(stage, 'server', 'caas_gate.js'));
fs.copyFileSync(path.join(here, '..', 'LICENSE'), path.join(stage, 'LICENSE'));

const out = path.join(here, 'caas-gate.mcpb');
const run = (args) => cp.execFileSync('npx', ['-y', '@anthropic-ai/mcpb', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
run(['validate', path.join(stage, 'manifest.json')]);
run(['pack', stage, out]);
fs.rmSync(stage, { recursive: true, force: true });
console.log('built: ' + out);
