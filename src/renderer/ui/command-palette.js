__cjsRegister('renderer/ui/command-palette.js', function (module, exports, require) {
// ==============================================================================
// 7. COMMAND PALETTE (Cmd+K)
// ==============================================================================
const cmdOverlay = document.getElementById('cmdPaletteOverlay');
const cmdInput = document.getElementById('cmdInput');

function initCommandPalette(deps) {
    document.addEventListener('keydown', (e) => {
        // Cmd+K or Ctrl+K
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            cmdOverlay.style.display = 'flex';
            cmdInput.value = '';
            cmdInput.focus();
        }
        
        // Close on ESC
        if (e.key === 'Escape' && cmdOverlay.style.display === 'flex') {
            cmdOverlay.style.display = 'none';
            cmdInput.blur();
        }
        
        // Submit on Enter
        if (e.key === 'Enter' && cmdOverlay.style.display === 'flex') {
            const text = cmdInput.value.trim();
            if (text && deps.getIsConnected()) {
                window.liveAPI.sendTextCommand(text);
                document.getElementById('userText').innerText = `Cmd: ${text}`;
                deps.setOrbState('thinking', 'Processing Command...');
            } else if (text && !deps.getIsConnected()) {
                alert("Please connect to Summer first by clicking the orb.");
            }
            cmdOverlay.style.display = 'none';
            cmdInput.blur();
        }
    });
}

module.exports = { initCommandPalette };
});
