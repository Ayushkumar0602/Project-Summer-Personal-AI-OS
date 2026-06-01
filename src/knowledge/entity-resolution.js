/**
 * Normalizes a string to help match similar entities.
 * e.g., "React.js", "React", "reactjs" -> "reactjs"
 */
function normalizeId(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Calculates Levenshtein distance between two strings to catch misspellings (e.g. whizan vs vizan)
 */
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Checks if two nodes refer to the same real-world entity.
 */
function isSameEntity(nodeA, nodeB) {
    // Exact ID match
    if (nodeA.id === nodeB.id) return true;
    
    // Explicit Ego Node preservation
    if (nodeA.id === 'user_self' || nodeB.id === 'user_self') {
        return nodeA.id === nodeB.id; 
    }

    // Normalized label match
    const labelA = normalizeId(nodeA.label);
    const labelB = normalizeId(nodeB.label);
    
    if (labelA.length > 2 && labelB.length > 2) {
        if (labelA === labelB) return true;
        
        // E.g. "javascript" and "js" 
        if (labelA.includes(labelB) || labelB.includes(labelA)) {
            if (nodeA.type === nodeB.type) return true;
        }

        // Fuzzy matching for speech-to-text misspellings (e.g., "whizan" vs "vizan")
        // Only apply fuzzy matching if they are of the same type, to avoid accidentally merging unrelated words
        if (nodeA.type === nodeB.type) {
            const distance = levenshteinDistance(labelA, labelB);
            const maxLength = Math.max(labelA.length, labelB.length);
            
            // If the strings are long enough (>4 chars) and distance is very small (1 or 2 edits), treat as same
            if (maxLength > 4 && distance <= 2) return true;
            
            // For short acronyms and words (<= 4 chars), NEVER apply fuzzy matching.
            // Example: "aws" vs "ams", "dog" vs "cog" should NOT merge.
            // Exact substring matches are already handled above, so no typos allowed here.
        }
    }
    
    return false;
}

module.exports = { isSameEntity, normalizeId, levenshteinDistance };
