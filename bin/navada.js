#!/usr/bin/env node
/**
 * ALEX CLI
 * Command-line interface for managing the Global Economist
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const WORKSPACE_PATH = process.env.ALEX_WORKSPACE || path.join(os.homedir(), '.alex');
const CONFIG_PATH = process.env.ALEX_CONFIG || path.join(WORKSPACE_PATH, 'config.json');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
    switch (command) {
        case 'start':
            console.log('Starting ALEX...');
            const gateway = spawn('node', [path.join(import.meta.dirname, '..', 'src', 'gateway.js')], {
                stdio: 'inherit',
                cwd: path.join(import.meta.dirname, '..')
            });
            gateway.on('close', code => process.exit(code));
            break;

        case 'status':
            try {
                execSync('systemctl status alex', { stdio: 'inherit' });
            } catch {
                console.log('Service not running or not installed.');
            }
            break;

        case 'restart':
            execSync('sudo systemctl restart alex', { stdio: 'inherit' });
            console.log('ALEX restarted');
            break;

        case 'stop':
            execSync('sudo systemctl stop alex', { stdio: 'inherit' });
            console.log('ALEX stopped');
            break;

        case 'logs':
            const follow = args.includes('-f') || args.includes('--follow');
            const logPath = path.join(WORKSPACE_PATH, 'logs', 'gateway.log');
            execSync(`tail ${follow ? '-f' : '-100'} "${logPath}"`, { stdio: 'inherit' });
            break;

        case 'config':
            try {
                const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
                // Mask sensitive values
                const masked = { ...config };
                if (masked.anthropic_api_key) masked.anthropic_api_key = '***' + masked.anthropic_api_key.slice(-4);
                if (masked.telegram_bot_token) masked.telegram_bot_token = '***' + masked.telegram_bot_token.slice(-4);
                if (masked.gmail_app_password) masked.gmail_app_password = '****';
                console.log(JSON.stringify(masked, null, 2));
            } catch {
                console.log('No configuration found. Run: alex-setup');
            }
            break;

        case 'memory':
            const memoryPath = path.join(WORKSPACE_PATH, 'memory');
            try {
                const files = await fs.readdir(memoryPath);
                console.log('Memory categories:');
                for (const file of files) {
                    const stat = await fs.stat(path.join(memoryPath, file));
                    console.log(`  - ${file} (${stat.size} bytes)`);
                }
            } catch {
                console.log('No memories yet.');
            }
            break;

        case 'skills':
            const skillsPath = path.join(WORKSPACE_PATH, 'skills');
            try {
                const skills = await fs.readdir(skillsPath);
                console.log('Installed skills:');
                for (const skill of skills) {
                    console.log(`  - ${skill}`);
                }
            } catch {
                console.log('No skills installed.');
            }
            break;

        case 'tasks':
            const tasksPath = path.join(WORKSPACE_PATH, 'tasks');
            try {
                const tasks = await fs.readdir(tasksPath);
                console.log('Scheduled tasks:');
                for (const task of tasks) {
                    if (task.endsWith('.json')) {
                        const data = JSON.parse(await fs.readFile(path.join(tasksPath, task), 'utf-8'));
                        console.log(`  - ${data.name}: ${data.cron_expression}`);
                    }
                }
            } catch {
                console.log('No scheduled tasks.');
            }
            break;

        case 'help':
        default:
            console.log(`
ALEX - Global Economist at NAVADA

Usage: alex <command>

Commands:
  start       Start ALEX in foreground
  status      Check service status
  restart     Restart the service
  stop        Stop the service
  logs        View logs (-f to follow)
  config      Show current configuration
  memory      List memory categories
  skills      List installed skills
  tasks       List scheduled tasks
  help        Show this help message

Setup:
  alex-setup    Run interactive setup wizard

Service management:
  sudo systemctl enable alex    Enable auto-start
  sudo systemctl disable alex   Disable auto-start
`);
            break;
    }
}

main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});
