/**
 * Google Calendar OAuth 2.0 + Calendar API integration
 */

import fs from 'fs/promises';

const REDIRECT_URI = 'http://localhost:9090/api/google-calendar/callback';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

/**
 * Generate OAuth authorization URL
 */
export function getAuthUrl(clientId) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: 'alex-gcal-' + Date.now(),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Exchange authorization code for access + refresh tokens
 */
export async function exchangeCodeForToken(code, config) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: config.google_calendar_client_id,
            client_secret: config.google_calendar_client_secret,
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    config.google_calendar_access_token = data.access_token;
    config.google_calendar_refresh_token = data.refresh_token || config.google_calendar_refresh_token;
    config.google_calendar_token_expires_at = Date.now() + (data.expires_in * 1000);
    await saveTokensToConfig(config);
    return data;
}

/**
 * Refresh token if within 5 minutes of expiry (Google tokens expire in 1hr)
 */
export async function refreshTokenIfNeeded(config) {
    if (!config.google_calendar_refresh_token) return false;
    const expiresAt = config.google_calendar_token_expires_at || 0;
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() < expiresAt - fiveMinutes) return false;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: config.google_calendar_refresh_token,
            client_id: config.google_calendar_client_id,
            client_secret: config.google_calendar_client_secret,
        }),
    });
    if (!res.ok) {
        console.error('[GCAL] Token refresh failed:', res.status);
        return false;
    }
    const data = await res.json();
    config.google_calendar_access_token = data.access_token;
    if (data.refresh_token) config.google_calendar_refresh_token = data.refresh_token;
    config.google_calendar_token_expires_at = Date.now() + (data.expires_in * 1000);
    await saveTokensToConfig(config);
    console.log('[GCAL] Token refreshed');
    return true;
}

/**
 * Helper: make an authenticated Calendar API request
 */
async function calendarFetch(config, endpoint, options = {}) {
    if (!config.google_calendar_access_token) {
        throw new Error('Google Calendar not connected. Use /googlecalendar to authorize.');
    }
    await refreshTokenIfNeeded(config);

    const url = endpoint.startsWith('http') ? endpoint : `https://www.googleapis.com/calendar/v3${endpoint}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${config.google_calendar_access_token}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Calendar API error (${res.status}): ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
}

/**
 * List upcoming calendar events
 */
export async function listEvents(config, { maxResults = 10, timeMin, timeMax } = {}) {
    const params = new URLSearchParams({
        maxResults: String(maxResults),
        singleEvents: 'true',
        orderBy: 'startTime',
    });
    if (timeMin) params.set('timeMin', timeMin);
    else params.set('timeMin', new Date().toISOString());
    if (timeMax) params.set('timeMax', timeMax);

    const data = await calendarFetch(config, `/calendars/primary/events?${params}`);
    return (data.items || []).map(e => ({
        id: e.id,
        summary: e.summary,
        description: e.description,
        location: e.location,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        attendees: (e.attendees || []).map(a => a.email),
        htmlLink: e.htmlLink,
    }));
}

/**
 * Create a new calendar event
 */
export async function createEvent(config, { summary, description, startTime, endTime, location, attendees }) {
    const body = {
        summary,
        description,
        location,
        start: { dateTime: startTime, timeZone: 'Europe/London' },
        end: { dateTime: endTime, timeZone: 'Europe/London' },
    };
    if (attendees && attendees.length > 0) {
        body.attendees = attendees.map(email => ({ email }));
    }
    const event = await calendarFetch(config, '/calendars/primary/events', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    return {
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        htmlLink: event.htmlLink,
    };
}

/**
 * Update an existing calendar event
 */
export async function updateEvent(config, { eventId, summary, description, startTime, endTime, location }) {
    const body = {};
    if (summary) body.summary = summary;
    if (description) body.description = description;
    if (location) body.location = location;
    if (startTime) body.start = { dateTime: startTime, timeZone: 'Europe/London' };
    if (endTime) body.end = { dateTime: endTime, timeZone: 'Europe/London' };

    const event = await calendarFetch(config, `/calendars/primary/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    return {
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        htmlLink: event.htmlLink,
    };
}

/**
 * Delete a calendar event
 */
export async function deleteEvent(config, { eventId }) {
    await calendarFetch(config, `/calendars/primary/events/${eventId}`, {
        method: 'DELETE',
    });
    return { deleted: true, eventId };
}

/**
 * Write Google Calendar tokens back to config.json
 */
async function saveTokensToConfig(config) {
    try {
        const configPath = config._configPath;
        if (!configPath) return;
        const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
        raw.google_calendar_access_token = config.google_calendar_access_token;
        raw.google_calendar_refresh_token = config.google_calendar_refresh_token;
        raw.google_calendar_token_expires_at = config.google_calendar_token_expires_at;
        await fs.writeFile(configPath, JSON.stringify(raw, null, 2));
    } catch (err) {
        console.error('[GCAL] Failed to save tokens:', err.message);
    }
}
