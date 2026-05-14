/**
 * airdrop-skill.js — AirDrop File Sharing Instructions
 */

module.exports = {
    name: 'AirDrop & File Sharing',
    
    summary: 'Send files via AirDrop to iPhone, iPad, Mac, or nearby devices',
    
    toolNames: [
        'airdrop_send_file',
    ],
    
    context: `
═══ AIRDROP SKILL — Operating Instructions ═══

## WORKFLOW (Follow this EXACTLY):

### Step 1: Find the file
ALWAYS use finder_search_files first to locate the file.
Example: finder_search_files(query="SQL Handbook")
→ Returns full paths like /Users/ayushjaiswal/Desktop/SQL Handbook.pdf

### Step 2: Confirm with user (if ambiguous)
If multiple files match, ask the user which one they meant.
If only one match, proceed directly.

### Step 3: Send via AirDrop
Use airdrop_send_file(path="/full/path/to/file")
→ This opens the macOS AirDrop share sheet showing nearby devices
→ The user then selects the target device (iPhone, iPad, Mac, etc.)

## RULES
- ALWAYS search for the file first — never guess paths
- The AirDrop share sheet appears on screen — the user picks the device
- If user says "send to my iPhone", tell them: "I've opened the AirDrop window. Please select your iPhone from the list."
- AirDrop requires both devices to have AirDrop enabled and be nearby
- Supported file types: ANY file (PDFs, images, videos, documents, etc.)

## EXAMPLES
User: "Send the SQL Handbook to my iPhone"
→ finder_search_files(query="SQL Handbook")
→ airdrop_send_file(path="/Users/ayushjaiswal/Desktop/SQL Handbook.pdf")
→ "I've opened AirDrop for SQL Handbook.pdf. Select your iPhone from the list to send it."

User: "AirDrop my resume to the MacBook"
→ finder_search_files(query="resume")
→ airdrop_send_file(path="/Users/ayushjaiswal/Documents/resume.pdf")

═══ END AIRDROP SKILL ═══
`
};
