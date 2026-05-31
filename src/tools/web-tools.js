const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Searches the web using DuckDuckGo Lite for a given query and returns a formatted string of results.
 */
async function searchWeb(query) {
    console.log(`[Tools] Searching web for: "${query}"`);
    try {
        const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
            },
            timeout: 10000
        });

        const $ = cheerio.load(data);
        const results = [];
        
        $('.result').each((i, el) => {
            const title = $(el).find('.result__title').text().trim();
            const url = $(el).find('.result__url').text().trim();
            const snippet = $(el).find('.result__snippet').text().trim();
            
            if (title && url) {
                let formattedUrl = url;
                if (!formattedUrl.startsWith('http')) {
                    formattedUrl = 'https://' + formattedUrl.replace(/\s/g, '');
                }
                results.push(`[${results.length + 1}] Title: ${title}\nURL: ${formattedUrl}\nSnippet: ${snippet}`);
            }
        });
        
        if (results.length === 0) {
            return "No results found for your query.";
        }

        const topResults = results.slice(0, 5).join('\n\n');

        return `Search results for "${query}":\n\n${topResults}\n\n[Action Required] If these snippets are not enough, use the 'scrape_webpage' tool to visit one of the URLs directly and read the full page content before giving your final answer.`;
    } catch (err) {
        console.error("[Tools] Search error:", err);
        return `Error searching the web: ${err.message}`;
    }
}

/**
 * Scrapes a specific webpage and extracts textual content.
 */
async function scrapeWebpage(url) {
    console.log(`[Tools] Scraping URL: "${url}"`);
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(data);
        
        // Remove unnecessary elements
        $('script, style, noscript, iframe, img, svg, video').remove();
        
        // Extract raw text
        let text = $('body').text();
        
        // Clean up whitespace
        text = text.replace(/\s+/g, ' ').trim();
        
        // Truncate to avoid blowing up context window (Gemini can handle a lot, but let's keep it reasonable)
        if (text.length > 20000) {
            text = text.substring(0, 20000) + "... [Content Truncated]";
        }

        return `Content from ${url}:\n\n${text}`;
    } catch (err) {
        console.error("[Tools] Scrape error:", err);
        return `Error scraping the webpage: ${err.message}`;
    }
}

/**
 * Fetches the latest news using NewsAPI.org.
 */
async function getNews(topic = '') {
    console.log(`[Tools] Fetching news for topic: "${topic}"`);
    try {
        const apiKey = '9930d02fc7a64f25b14f150c0621bfd1';
        let url = 'https://newsapi.org/v2/top-headlines?language=en&apiKey=' + apiKey;
        if (topic) {
            url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&language=en&sortBy=publishedAt&apiKey=` + apiKey;
        }

        const { data } = await axios.get(url, { timeout: 10000 });
        
        if (data.status !== 'ok') {
            return `Error fetching news: ${data.message || 'Unknown error'}`;
        }

        if (!data.articles || data.articles.length === 0) {
            return `No news found for topic: ${topic || 'top headlines'}.`;
        }

        const articles = data.articles.slice(0, 5).map((a, i) => {
            return `[${i + 1}] Title: ${a.title}\nSource: ${a.source.name}\nDescription: ${a.description || 'N/A'}\nURL: ${a.url}`;
        }).join('\n\n');

        return `Top news ${topic ? 'for "' + topic + '"' : 'headlines'}:\n\n${articles}`;
    } catch (err) {
        console.error("[Tools] News fetch error:", err);
        return `Error fetching news: ${err.message}`;
    }
}

/**
 * Searches the web for images using Serper API (Google Images) and returns display-ready results.
 * Falls back to Unsplash if Serper search fails or API key is missing.
 */
async function searchImages(query, count = 4) {
    const safeCount = Math.min(Math.max(1, count || 4), 8);
    console.log(`[Tools] Searching Google images for: "${query}" (${safeCount} results)`);

    // PRIMARY: Google image search via Serper.dev
    try {
        const SERPER_API_KEY = process.env.SERPER_API_KEY;
        if (SERPER_API_KEY) {
            const { data } = await axios.post(
                'https://google.serper.dev/images',
                { q: query },
                {
                    headers: {
                        'X-API-KEY': SERPER_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            const arr = data.images || [];
            if (arr.length > 0) {
                const images = arr.slice(0, safeCount).map(r => ({
                    url: r.imageUrl,
                    fullUrl: r.imageUrl,
                    label: r.title || query,
                    credit: r.source || r.domain || 'Google Images',
                    width: r.imageWidth,
                    height: r.imageHeight
                }));
                console.log(`[Tools] Serper Images: Found ${images.length} results for "${query}"`);
                return { images, query, source: 'serper' };
            }
        } else {
             console.warn(`[Tools] SERPER_API_KEY not found. Skipping primary image search...`);
        }
    } catch (apiErr) {
        console.warn(`[Tools] Serper image search failed: ${apiErr.message}. Trying Unsplash fallback...`);
    }

    // FALLBACK: Unsplash (if Serper fails)
    const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
    if (!UNSPLASH_KEY) {
        return { images: [], query, error: 'Both Google and Unsplash search unavailable.' };
    }
    try {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${safeCount}&orientation=landscape`;
        const { data } = await axios.get(url, {
            headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
            timeout: 8000
        });
        const images = (data.results || []).slice(0, safeCount).map(r => ({
            url: r.urls.small,
            fullUrl: r.urls.regular,
            label: r.description || r.alt_description || query,
            credit: `Photo by ${r.user.name} on Unsplash`
        }));
        console.log(`[Tools] Unsplash fallback: Found ${images.length} images for "${query}"`);
        return { images, query, source: 'unsplash' };
    } catch (err) {
        console.error('[Tools] Image search fully failed:', err.message);
        return { images: [], query, error: err.message };
    }
}

module.exports = { searchWeb, scrapeWebpage, getNews, searchImages };

