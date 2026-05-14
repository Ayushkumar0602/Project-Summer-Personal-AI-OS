/**
 * finder-skill.js — File Management Operating Instructions
 */

module.exports = {
    name: 'File Management',
    
    summary: 'Search, list, create, and delete files and folders',
    
    toolNames: [
        'finder_list_files',
        'finder_search_files',
        'finder_create_folder',
        'finder_delete_file',
    ],
    
    context: `
═══ FILE MANAGEMENT SKILL ═══

## WORKFLOW — Always follow this order:

### Finding files:
1. ALWAYS use finder_search_files FIRST (uses macOS Spotlight — fast, searches everywhere)
2. Use finder_list_files only if you need to see ALL files in a specific directory

### Deleting files:
1. First use finder_search_files to find the exact file path
2. Then use finder_delete_file with the FULL ABSOLUTE PATH (e.g., /Users/ayushjaiswal/Desktop/screenshot.png)
3. Files are moved to Trash (recoverable) — not permanently deleted
4. Permission is asked once, then remembered

### Creating folders:
→ Use finder_create_folder with full path (e.g., ~/Desktop/NewProject)

## RULES
- NEVER guess file paths — always search first
- Use absolute paths starting with /Users/ (not relative paths)
- ~/Desktop expands to /Users/ayushjaiswal/Desktop
- Common locations: ~/Desktop, ~/Downloads, ~/Documents, ~/Pictures

═══ END FILE SKILL ═══
`
};
