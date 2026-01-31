#!/usr/bin/env node
/**
 * ALEX Setup Wizard
 * Interactive configuration for the Global Economist
 */

import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const WORKSPACE_PATH = path.join(os.homedir(), '.alex');
const CONFIG_PATH = path.join(WORKSPACE_PATH, 'config.json');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

function askSecret(question) {
    return new Promise(resolve => {
        process.stdout.write(question);
        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let password = '';
        stdin.on('data', function handler(ch) {
            ch = ch.toString('utf8');

            switch (ch) {
                case '\n':
                case '\r':
                case '\u0004':
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.removeListener('data', handler);
                    console.log('');
                    resolve(password);
                    break;
                case '\u0003':
                    process.exit();
                    break;
                case '\u007F':
                    password = password.slice(0, -1);
                    break;
                default:
                    password += ch;
                    process.stdout.write('*');
                    break;
            }
        });
    });
}

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║            ALEX - Global Economist Setup                   ║');
    console.log('║            NAVADA VC                                       ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    // Check for existing config
    let existingConfig = {};
    try {
        existingConfig = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
        console.log('Found existing configuration.');
        const update = await ask('Would you like to update it? (y/N): ');
        if (update.toLowerCase() !== 'y') {
            console.log('Setup cancelled.');
            process.exit(0);
        }
    } catch {
        console.log('Creating new configuration...');
    }

    // Create workspace
    console.log('');
    console.log('Setting up workspace at:', WORKSPACE_PATH);
    await fs.mkdir(WORKSPACE_PATH, { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'memory'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'conversations'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'skills'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'reports'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'research'), { recursive: true });
    await fs.mkdir(path.join(WORKSPACE_PATH, 'data'), { recursive: true });

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                     API Configuration                          ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // Anthropic API Key
    console.log('Anthropic API Key');
    console.log('   Get yours from: https://console.anthropic.com/');
    const anthropicKey = await askSecret('   Enter API key: ') || existingConfig.anthropic_api_key;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                   Telegram Configuration                       ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // Telegram Bot Token
    console.log('Telegram Bot Token');
    console.log('   1. Open Telegram and message @BotFather');
    console.log('   2. Send /newbot and follow the prompts');
    console.log('   3. Copy the token it gives you');
    const telegramToken = await askSecret('   Enter bot token: ') || existingConfig.telegram_bot_token;

    console.log('');

    // Telegram Owner ID
    console.log('Telegram User ID (for authorization)');
    console.log('   Message @userinfobot on Telegram to get your ID');
    const telegramOwnerId = await ask('   Enter your Telegram user ID: ') || existingConfig.telegram_owner_id;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    Email Configuration                         ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // Gmail setup
    console.log('Gmail Configuration (for sending emails)');
    console.log('   You need a Gmail App Password:');
    console.log('   1. Go to myaccount.google.com → Security');
    console.log('   2. Enable 2-Step Verification');
    console.log('   3. Create an App Password for "Mail"');
    console.log('');

    const gmailAddress = await ask('   Gmail address: ') || existingConfig.gmail_address;
    const gmailPassword = await askSecret('   App Password: ') || existingConfig.gmail_app_password;
    const recipientEmail = await ask('   Default recipient (e.g., lee@navada.info): ') || existingConfig.recipient_email || 'lee@navada.info';

    // Build config
    const config = {
        anthropic_api_key: anthropicKey,
        telegram_bot_token: telegramToken,
        telegram_owner_id: parseInt(telegramOwnerId) || null,
        telegram_authorized_users: telegramOwnerId ? [parseInt(telegramOwnerId)] : [],
        telegram_notify_tasks: true,
        gmail_address: gmailAddress,
        gmail_app_password: gmailPassword,
        recipient_email: recipientEmail,
        workspace_path: WORKSPACE_PATH,
        created_at: new Date().toISOString()
    };

    // Save config
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
    await fs.chmod(CONFIG_PATH, 0o600);

    console.log('');
    console.log('Configuration saved to:', CONFIG_PATH);

    // Create email sending script
    const emailScript = `#!/usr/bin/env node
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const config = JSON.parse(
    await fs.readFile(path.join(os.homedir(), '.alex/config.json'), 'utf-8')
);

const [,, to, subject, body] = process.argv;

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: config.gmail_address,
        pass: config.gmail_app_password
    }
});

try {
    await transporter.sendMail({
        from: \`"ALEX" <\${config.gmail_address}>\`,
        to: to || config.recipient_email,
        subject: subject || 'Message from ALEX',
        html: body || 'No content'
    });
    console.log('Email sent successfully');
} catch (error) {
    console.error('Failed to send email:', error.message);
    process.exit(1);
}
`;

    await fs.writeFile(
        path.join(WORKSPACE_PATH, 'scripts', 'send_email.js'),
        emailScript
    );

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    System Service Setup                        ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    const installService = await ask('Install as systemd service? (Y/n): ');

    if (installService.toLowerCase() !== 'n') {
        const serviceContent = `[Unit]
Description=ALEX - Global Economist at NAVADA VC
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${os.userInfo().username}
WorkingDirectory=${path.dirname(process.argv[1]).replace('/bin', '')}
ExecStart=/usr/bin/node ${path.dirname(process.argv[1]).replace('/bin', '')}/src/gateway.js
Restart=always
RestartSec=10
StandardOutput=append:${WORKSPACE_PATH}/logs/gateway.log
StandardError=append:${WORKSPACE_PATH}/logs/gateway.log
Environment=NODE_ENV=production
Environment=ALEX_WORKSPACE=${WORKSPACE_PATH}
Environment=ALEX_CONFIG=${CONFIG_PATH}

[Install]
WantedBy=multi-user.target
`;

        await fs.mkdir(path.join(WORKSPACE_PATH, 'logs'), { recursive: true });

        const servicePath = '/etc/systemd/system/alex.service';
        const tempPath = path.join(WORKSPACE_PATH, 'alex.service');

        await fs.writeFile(tempPath, serviceContent);

        console.log('');
        console.log('To complete service installation, run:');
        console.log('');
        console.log(`  sudo cp ${tempPath} ${servicePath}`);
        console.log('  sudo systemctl daemon-reload');
        console.log('  sudo systemctl enable alex');
        console.log('  sudo systemctl start alex');
        console.log('');

        const autoInstall = await ask('Run these commands now? (y/N): ');

        if (autoInstall.toLowerCase() === 'y') {
            try {
                execSync(`sudo cp ${tempPath} ${servicePath}`, { stdio: 'inherit' });
                execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
                execSync('sudo systemctl enable alex', { stdio: 'inherit' });
                execSync('sudo systemctl start alex', { stdio: 'inherit' });
                console.log('');
                console.log('Service installed and started!');
            } catch (error) {
                console.error('Failed to install service:', error.message);
            }
        }
    }

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║            ALEX Setup Complete!                            ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Workspace:', WORKSPACE_PATH);
    console.log('Config:', CONFIG_PATH);
    console.log('');
    console.log('To start ALEX manually:');
    console.log('  npm start');
    console.log('');
    console.log('To manage the service:');
    console.log('  sudo systemctl status alex');
    console.log('  sudo systemctl restart alex');
    console.log('  sudo systemctl stop alex');
    console.log('');
    console.log('View logs:');
    console.log(`  tail -f ${WORKSPACE_PATH}/logs/gateway.log`);
    console.log('');
    console.log('Open Telegram and message your bot to get started!');
    console.log('');

    rl.close();
}

main().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
});
