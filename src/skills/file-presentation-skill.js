/**
 * file-presentation-skill.js — Holographic File & Media Presentation Instructions
 */

module.exports = {
    name: 'File Presentation',
    
    summary: 'Rules for presenting media and files dynamically on the Holographic UI (HUD).',
    
    toolNames: [
        'show_hologram_widget'
    ],
    
    context: `
═══ FILE PRESENTATION SKILL ═══

## PRESENTING LOCAL FILES AND MEDIA

When the user asks you to "play", "show", "present", or "view" a local file (e.g., an mp3, mp4, or a document), you must ALWAYS prioritize showing it dynamically on the Holographic UI using \`show_hologram_widget\`. DO NOT use \`os_open_file\` unless the user explicitly says "open it in [App]" or "open it natively".

### Widget Types & Usage

1. **Audio (mp3, wav, etc.)**
   - Use type: \`audio_player\`
   - Pass an array with ONE object inside \`data\`.
   - Object properties: \`{ title: "Song Name", path: "/absolute/path/to/audio.mp3" }\` (if local) OR \`{ title: "Voice Note", url: "https://...supabase.co/..." }\` (if publicUrl exists in memory).

2. **Video (mp4, webm, etc.)**
   - Use type: \`video_player\`
   - Pass an array with ONE object inside \`data\`.
   - Object properties: \`{ title: "Video Name", path: "/absolute/path/to/video.mp4" }\` (if local) OR \`{ title: "Video Name", url: "https://..." }\` (if publicUrl exists).

3. **Other Files (Documents, PDFs, Archives)**
   - Use type: \`file_viewer\`
   - Pass an array with ONE object inside \`data\`.
   - Object properties: \`{ filename: "document.pdf", metadata: "PDF Document • 2MB", icon: "📄", path: "/absolute/path/to/document.pdf" }\` (if local) OR \`{ filename: "doc.pdf", url: "https://..." }\`.
   - Common Icons: 📄 for docs, 📊 for spreadsheets, 📦 for zips, 🖼️ for images, 📝 for text files.

### Critical Rules
- Ensure the \`path\` provided is ABSOLUTE (e.g., \`/Users/ayushjaiswal/Desktop/song.mp3\`).
- If you don't know the exact path, use the \`finder_search_files\` tool first to locate the file, then present it.
- Do NOT use \`os_open_file\` to play media. The holographic player provides a much better experience.
- The system will use the \`summer-media://\` secure protocol automatically under the hood to stream the content to the UI based on your provided \`path\`.

═══ END FILE PRESENTATION SKILL ═══
`
};
