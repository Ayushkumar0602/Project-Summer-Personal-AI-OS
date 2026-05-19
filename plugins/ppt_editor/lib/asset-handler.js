const xml2js = require('xml2js');

async function handleAssets(xmlString, manifest) {
  const parser = new xml2js.Parser({ explicitArray: false, preserveChildrenOrder: true });
  const builder = new xml2js.Builder({ headless: true });
  
  let xmlObj;
  try {
    xmlObj = await parser.parseStringPromise(xmlString);
  } catch (e) {
    console.error("Failed to parse XML:", e);
    // Return original if parsing fails so we don't crash
    return xmlString; 
  }

  // Recursive function to find IMG tags and attach real URLs
  async function processImages(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // If we found an IMG tag with a query
    if (obj.IMG && obj.IMG.$ && obj.IMG.$.query) {
      const query = obj.IMG.$.query;
      try {
        const url = await fetchUnsplashImage(query);
        if (url) {
          obj.IMG.$.url = url;
        }
      } catch (e) {
        console.warn(`Failed to fetch image for query "${query}":`, e.message);
      }
    }
    
    // Handle array of IMG tags
    if (Array.isArray(obj.IMG)) {
        for (let i = 0; i < obj.IMG.length; i++) {
            if (obj.IMG[i] && obj.IMG[i].$ && obj.IMG[i].$.query) {
                const query = obj.IMG[i].$.query;
                try {
                  const url = await fetchUnsplashImage(query);
                  if (url) {
                    obj.IMG[i].$.url = url;
                  }
                } catch (e) {
                  console.warn(`Failed to fetch image for query "${query}":`, e.message);
                }
            }
        }
    }

    // Recurse into children
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        if (Array.isArray(obj[key])) {
          for (const item of obj[key]) {
            await processImages(item);
          }
        } else {
          await processImages(obj[key]);
        }
      }
    }
  }

  await processImages(xmlObj);
  
  return builder.buildObject(xmlObj);
}

async function fetchUnsplashImage(query) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return null;

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Unsplash API error: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.results && data.results.length > 0) {
    return data.results[0].urls.regular;
  }
  
  return null;
}

module.exports = { handleAssets };
