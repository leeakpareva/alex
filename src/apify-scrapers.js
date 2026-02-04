/**
 * Apify Scrapers Registry
 * Central hub for all Apify-powered scrapers available to ALEX
 */

export const APIFY_SCRAPERS = [
    {
        id: 'tiktok',
        name: 'TikTok Scraper',
        actor: 'clockworks~tiktok-scraper',
        tool: 'tiktok_scrape',
        command: '/tiktok',
        description: 'Scrape TikTok videos by hashtag, profile, or search query',
        cost: '~$5 per 1,000 videos',
        usage: '/tiktok hashtag viral 20',
        timeout: 180000,
    },
    {
        id: 'linkedin',
        name: 'LinkedIn Posts Search',
        actor: 'apimaestro~linkedin-posts-search-scraper-no-cookies',
        tool: 'linkedin_posts_search',
        command: '/linkedinposts',
        description: 'Search LinkedIn posts by keyword with filters',
        cost: '~$5 per 1,000 posts',
        usage: '/linkedinposts AI startups --date past-week',
        timeout: 180000,
    },
    {
        id: 'indeed',
        name: 'Indeed Job Search',
        actor: 'misceres~indeed-scraper',
        tool: 'indeed_job_search',
        command: '/indeed',
        description: 'Search Indeed job listings by position, location, country',
        cost: '~$5 per 1,000 jobs (~£4)',
        usage: '/indeed "web developer" London --limit 50',
        timeout: 180000,
    },
    {
        id: 'leads',
        name: 'Google Maps Lead Scraper',
        actor: 'compass~crawler-google-places',
        tool: 'google_maps_leads',
        command: '/leads',
        description: 'Find businesses on Google Maps with employee contact enrichment',
        cost: '~$4/1000 places + $0.005/lead',
        usage: '/leads "tech startup" London --max 20',
        timeout: 300000,
    },
];

export function getScraperByCommand(cmd) {
    return APIFY_SCRAPERS.find(s => s.command === cmd);
}

export function getScraperById(id) {
    return APIFY_SCRAPERS.find(s => s.id === id);
}

export function formatScrapersMenu() {
    let text = '*Apify Scrapers*\n\n';
    APIFY_SCRAPERS.forEach((s, i) => {
        text += `*${i + 1}. ${s.name}*\n`;
        text += `   ${s.command} — ${s.description}\n`;
        text += `   Cost: ${s.cost}\n`;
        text += `   Example: \`${s.usage}\`\n\n`;
    });
    text += `_All scrapers are owner-only due to API costs._`;
    return text;
}
