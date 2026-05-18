__cjsRegister('renderer/ui/sessions-modal.js', function (module, exports, require) {
// ==============================================================================
// 8. PAST SESSIONS MODAL
// ==============================================================================
let _deps = {};

function initSessionsModal(deps) {
    _deps = deps;
}

async function openSessionsModal() {
    const modal = document.getElementById('sessionsModal');
    const list = document.getElementById('sessionsList');
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Loading...</div>';
    modal.style.display = 'flex';
    
    try {
        const diary = await window.liveAPI.getDiary();
        if (!diary || diary.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">No past sessions found.</div>';
            return;
        }
        
        let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
        diary.forEach(entry => {
            html += `
                <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; border:1px solid rgba(6,182,212,0.2);">
                    <div style="font-size:10px; color:#06b6d4; margin-bottom:6px;">${entry.date}</div>
                    <div style="font-size:13px; line-height:1.4; color:#f1f5f9; margin-bottom:10px;">${entry.entry}</div>
                    <button onclick="continueSession(${entry.timestamp})" style="background:rgba(124, 58, 237, 0.2); border:1px solid #7c3aed; color:#c4b5fd; padding:6px 12px; border-radius:4px; font-size:12px; cursor:pointer;">Continue this Session</button>
                </div>
            `;
        });
        html += '</div>';
        list.innerHTML = html;
    } catch (e) {
        list.innerHTML = '<div style="color:#ef4444;">Error loading sessions.</div>';
    }
}

function closeSessionsModal() {
    document.getElementById('sessionsModal').style.display = 'none';
}

function continueSession(timestamp) {
    window.liveAPI.getDiary().then(diary => {
        const entry = diary.find(d => d.timestamp === timestamp);
        if (entry) {
            _deps.setSelectedContinueDiary(entry);
            closeSessionsModal();
            _deps.setOrbState('idle', 'Ready to continue session. Click to connect.');
            document.getElementById('subtitleText').innerText = `Queued context from ${entry.date}`;
        }
    });
}

module.exports = { initSessionsModal, openSessionsModal, closeSessionsModal, continueSession };
});
