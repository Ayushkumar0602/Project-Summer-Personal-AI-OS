/**
 * music-skill.js — Spotify & Apple Music Operating Instructions
 */

module.exports = {
    name: 'Music Control',
    
    summary: 'Play/pause, skip tracks, get now playing from Spotify or Apple Music',
    
    toolNames: [
        'music_play_pause',
        'music_next',
        'music_previous',
        'music_now_playing',
    ],
    
    context: `
═══ MUSIC CONTROL SKILL ═══

You control Spotify and Apple Music via AppleScript. The tools automatically try Spotify first, then fall back to Apple Music.

## AVAILABLE TOOLS
- music_play_pause → Toggle play/pause
- music_next → Skip to next track
- music_previous → Go to previous track  
- music_now_playing → Get current song info (title, artist, album, position)

## RULES
- You do NOT need to open Spotify/Music first — the tools handle it
- If user says "play music" and nothing is playing, use music_play_pause (it resumes last session)
- If user asks "what song is this?" → use music_now_playing
- If user says "skip" / "next" → use music_next
- For specific songs/playlists, you CANNOT search — tell the user to open the song manually, then you can control playback

═══ END MUSIC SKILL ═══
`
};
