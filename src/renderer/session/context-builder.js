__cjsRegister('renderer/session/context-builder.js', function (module, exports, require) {
let selectedContinueDiary = null;
let _setOrbState = null;

function initContextBuilder(deps) {
    _setOrbState = deps.setOrbState;
}

function getSelectedContinueDiary() { return selectedContinueDiary; }
function setSelectedContinueDiary(val) { selectedContinueDiary = val; }

// Shared context builder used by both orb-click and wake-word activation
async function buildContextPayload() {
    let contextPayload = null;
    try {
        _setOrbState('thinking', 'Locating...');
        const ipRes = await fetch('http://ip-api.com/json/');
        const ipData = await ipRes.json();
        const lat = ipData.lat;
        const lon = ipData.lon;
        const city = ipData.city;
        
        if (lat && lon) {
            _setOrbState('thinking', 'Checking weather...');
            const apiKey = 'AIzaSyCfF0iZYvUiF_rB6DSKHAKwW0XYF5D3umQ';
            const res = await fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lon}&key=${apiKey}`);
            const data = await res.json();
            
            if (data.weatherCondition) {
                const temp = data.temperature?.degrees;
                const condition = data.weatherCondition?.description?.text;
                const time = new Date().toLocaleString();
                contextPayload = {
                    weatherContext: `User Location: ${city} (${lat}, ${lon})\nCurrent Local Time: ${time}\nCurrent Weather: ${temp}°C, ${condition}`
                };
            }
        }
    } catch (err) {
        console.error("Failed to fetch context:", err);
    }
    if (selectedContinueDiary) {
        if (!contextPayload) contextPayload = {};
        contextPayload.continueDiary = selectedContinueDiary;
        console.log("Continuing past session:", selectedContinueDiary.date);
    }

    _setOrbState('thinking', 'Checking Google schedule...');
    try {
        const googleCtx = await window.liveAPI.getGoogleContext();
        if (googleCtx) {
            if (!contextPayload) contextPayload = {};
            contextPayload.googleContext = googleCtx;
        }
    } catch (e) {
        console.error("Failed to fetch Google context:", e);
    }

    return contextPayload;
}

module.exports = {
    buildContextPayload,
    getSelectedContinueDiary,
    setSelectedContinueDiary,
    initContextBuilder,
};
});
