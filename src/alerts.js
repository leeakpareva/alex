/**
 * Alerts system — stock/service threshold monitoring
 * Config stored at ~/.alex/alerts.json
 * Alert state tracked to avoid duplicate notifications
 */

import fs from 'fs/promises';
import path from 'path';

export class AlertsSystem {
    constructor(workspacePath) {
        this.configPath = path.join(workspacePath, 'alerts.json');
        this.statePath = path.join(workspacePath, 'alerts-state.json');
    }

    async getAlerts() {
        try {
            const raw = await fs.readFile(this.configPath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            // Default alerts
            return {
                stocks: [],
                // Example: { symbol: 'AAPL', above: 200, below: 150 }
            };
        }
    }

    async getState() {
        try {
            const raw = await fs.readFile(this.statePath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return { lastFired: {} };
        }
    }

    async saveState(state) {
        await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
    }

    /**
     * Check if an alert has already been fired recently (within cooldown hours)
     */
    wasRecentlyFired(state, alertKey, cooldownHours = 24) {
        const lastFired = state.lastFired[alertKey];
        if (!lastFired) return false;
        const elapsed = Date.now() - new Date(lastFired).getTime();
        return elapsed < cooldownHours * 3600000;
    }

    markFired(state, alertKey) {
        state.lastFired[alertKey] = new Date().toISOString();
    }
}
