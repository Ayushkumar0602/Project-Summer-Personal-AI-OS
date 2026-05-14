const { google } = require('googleapis');
const { getClient, isAuthenticated } = require('../auth/google-auth');

/**
 * Searches YouTube for a video.
 */
async function searchYouTube(query, maxResults = 5) {
    if (!(await isAuthenticated())) throw new Error("YouTube not connected.");
    const youtube = google.youtube({ version: 'v3', auth: getClient() });

    const res = await youtube.search.list({
        part: 'snippet',
        q: query,
        maxResults,
        type: 'video',
        videoEmbeddable: 'true'
    });

    const items = res.data.items;
    if (!items || items.length === 0) return `No videos found for query: ${query}`;

    let resultStr = `YOUTUBE SEARCH RESULTS:\n`;
    items.forEach(item => {
        resultStr += `- Video ID: ${item.id.videoId} | Title: "${item.snippet.title}" | Channel: ${item.snippet.channelTitle}\n`;
    });
    
    // Also return the top video ID for auto-play if needed
    const topVideoId = items[0].id.videoId;
    return { textSummary: resultStr, topVideoId };
}

module.exports = { searchYouTube };
