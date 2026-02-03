/**
 * LinkedIn OAuth 2.0 + Posts API integration
 */

import fs from 'fs/promises';

const REDIRECT_URI = 'http://localhost:9090/api/linkedin/callback';
const SCOPES = 'openid profile w_member_social';

/**
 * Generate OAuth authorization URL
 */
export function getAuthUrl(clientId) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state: 'alex-linkedin-' + Date.now(),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

/**
 * Exchange authorization code for access + refresh tokens
 */
export async function exchangeCodeForToken(code, config) {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: config.linkedin_client_id,
            client_secret: config.linkedin_client_secret,
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    // Save tokens to config
    config.linkedin_access_token = data.access_token;
    config.linkedin_refresh_token = data.refresh_token || config.linkedin_refresh_token;
    config.linkedin_token_expires_at = Date.now() + (data.expires_in * 1000);
    await saveTokensToConfig(config);
    return data;
}

/**
 * Refresh token if within 7 days of expiry
 */
export async function refreshTokenIfNeeded(config) {
    if (!config.linkedin_refresh_token) return false;
    const expiresAt = config.linkedin_token_expires_at || 0;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() < expiresAt - sevenDays) return false;

    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: config.linkedin_refresh_token,
            client_id: config.linkedin_client_id,
            client_secret: config.linkedin_client_secret,
        }),
    });
    if (!res.ok) {
        console.error('[LINKEDIN] Token refresh failed:', res.status);
        return false;
    }
    const data = await res.json();
    config.linkedin_access_token = data.access_token;
    config.linkedin_refresh_token = data.refresh_token || config.linkedin_refresh_token;
    config.linkedin_token_expires_at = Date.now() + (data.expires_in * 1000);
    await saveTokensToConfig(config);
    console.log('[LINKEDIN] Token refreshed');
    return true;
}

/**
 * Get LinkedIn profile (person URN + name)
 */
export async function getProfile(accessToken) {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Profile fetch failed (${res.status})`);
    const data = await res.json();
    return {
        personUrn: `urn:li:person:${data.sub}`,
        name: data.name || `${data.given_name || ''} ${data.family_name || ''}`.trim(),
    };
}

/**
 * Create a LinkedIn post (text, optional link URL)
 */
export async function createPost({ text, linkUrl }, config) {
    if (!config.linkedin_access_token) {
        throw new Error('LinkedIn not connected. Use /linkedin to authorize.');
    }
    await refreshTokenIfNeeded(config);

    if (!config.linkedin_person_urn) {
        const profile = await getProfile(config.linkedin_access_token);
        config.linkedin_person_urn = profile.personUrn;
        await saveTokensToConfig(config);
    }

    const body = {
        author: config.linkedin_person_urn,
        lifecycleState: 'PUBLISHED',
        visibility: 'PUBLIC',
        commentary: text,
        distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
    };

    if (linkUrl) {
        body.content = {
            article: {
                source: linkUrl,
                title: text.substring(0, 200),
            },
        };
    }

    const res = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.linkedin_access_token}`,
            'Content-Type': 'application/json',
            'LinkedIn-Version': '202401',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`LinkedIn post failed (${res.status}): ${errText}`);
    }

    const postId = res.headers.get('x-restli-id') || 'unknown';
    return { success: true, postId, message: 'Posted to LinkedIn successfully.' };
}

/**
 * Write linkedin tokens back to config.json
 */
async function saveTokensToConfig(config) {
    try {
        const configPath = config._configPath;
        if (!configPath) return;
        const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
        raw.linkedin_access_token = config.linkedin_access_token;
        raw.linkedin_refresh_token = config.linkedin_refresh_token;
        raw.linkedin_token_expires_at = config.linkedin_token_expires_at;
        raw.linkedin_person_urn = config.linkedin_person_urn;
        await fs.writeFile(configPath, JSON.stringify(raw, null, 2));
    } catch (err) {
        console.error('[LINKEDIN] Failed to save tokens:', err.message);
    }
}
