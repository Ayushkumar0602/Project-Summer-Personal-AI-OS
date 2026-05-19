__cjsRegister('renderer/hud/widget-manager.js', function (module, exports, require) {
// --- Advanced Holographic HUD Engine ---
class WidgetManager {
    constructor() {
        this.zones = {
            'left': document.getElementById('hud-left-wing'),
            'right': document.getElementById('hud-right-wing'),
            'top': document.getElementById('hud-top'),
            'bottom': document.getElementById('hud-bottom-dock'),
            'weather': document.getElementById('hud-fixed-weather'),
            'schedule': document.getElementById('hud-fixed-schedule')
        };
        this.activeTimeouts = new Map();
    }

    drawNeuralLine(widget, color) {
        const svg = document.getElementById('neural-lines');
        if (!svg) return;
        
        // Slight delay to ensure widget is rendered and positioned
        setTimeout(() => {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const widgetRect = widget.getBoundingClientRect();
            
            // Start from center of screen (orb)
            const startX = window.innerWidth / 2;
            const startY = window.innerHeight / 2;
            
            // End at the edge of the widget
            const endX = widgetRect.left + (widgetRect.width / 2);
            const endY = widgetRect.top + (widgetRect.height / 2);
            
            // Create a techy bezier curve path instead of a straight line
            // C controlPoint1X controlPoint1Y, controlPoint2X controlPoint2Y, endX endY
            // We use the midpoint X for control points to create an elegant S-curve
            const midX = startX + (endX - startX) / 2;
            const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
            
            path.setAttribute('d', d);
            path.setAttribute('class', 'neural-path');
            path.setAttribute('stroke', color);
            path.id = `path-${widget.id}`;
            
            svg.appendChild(path);
        }, 50);
    }

    decryptText(element, finalString) {
        if (!finalString) return;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+<>?';
        let iterations = 0;
        
        const interval = setInterval(() => {
            element.innerText = finalString.split('').map((char, index) => {
                if (char === ' ') return ' ';
                if (index < iterations) return char;
                return chars[Math.floor(Math.random() * chars.length)];
            }).join('');
            
            iterations += 1/3; // Speed of decryption
            if (iterations >= finalString.length) {
                clearInterval(interval);
                element.innerText = finalString;
            }
        }, 20);
    }

    addTiltEffect(element) {
        element.addEventListener('mousemove', (e) => {
            const rect = element.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = ((y - centerY) / centerY) * -10; // Max 10 deg
            const rotateY = ((x - centerX) / centerX) * 10;
            
            element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
        });
        
        element.addEventListener('mouseleave', () => {
            element.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        });
    }

    _buildAgentLogs(recentLogs, barColor) {
        let html = '';
        recentLogs.forEach((l, i) => {
            const isLast = i === recentLogs.length - 1;
            const opacity = isLast ? 1 : (0.3 + (i / recentLogs.length) * 0.4);
            const color = isLast ? '#ffffff' : '#94a3b8';
            const bullet = isLast ? `<span style="color:${barColor}; text-shadow: 0 0 8px ${barColor};">●</span>` : '○';
            html += `
                <div style="font-size: 13px; color: ${color}; opacity: ${opacity}; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 10px; font-family: 'Inter', sans-serif; transition: all 0.3s ease;">
                    <div style="margin-top: 2px; font-size: 10px;">${bullet}</div>
                    <div style="line-height: 1.4; flex: 1;">${l.replace(/"/g, '&quot;')}</div>
                </div>
            `;
        });
        return html;
    }

    showWidget(type, data, append, width, height) {
        // Determine the spatial zone based on the widget type
        let zoneKey = 'right';
        if (type === 'welcome') zoneKey = 'top';
        else if (type === 'weather') zoneKey = 'weather';
        else if (type === 'calendar') zoneKey = 'schedule';
        else if (type === 'map' || type === 'sheet-data') zoneKey = 'right';
        else if (type === 'youtube') zoneKey = 'bottom';
        else if (type === 'mermaid' || type === 'image_gallery' || type === 'agent_progress') zoneKey = 'top';
        else if (type === 'news' || type === 'emails' || type === 'full-email') zoneKey = 'left';

        const container = this.zones[zoneKey];

        if (type === 'clear') {
            // Do NOT clear weather or schedule (persistent fixed widgets)
            ['left', 'right', 'top', 'bottom'].forEach(k => { if(this.zones[k]) this.zones[k].innerHTML = ''; });
            this.activeTimeouts.forEach(t => clearTimeout(t));
            this.activeTimeouts.clear();
            const svg = document.getElementById('neural-lines');
            if (svg) svg.innerHTML = '';
            return;
        }

        if (!append) {
            container.innerHTML = '';
        }

        const widgetId = 'widget-' + Date.now() + Math.random().toString(36).substr(2, 5);
        const widget = document.createElement('div');
        widget.className = 'hud-widget';
        widget.id = widgetId;
        
        if (width) widget.style.width = `${width}px`;
        if (height) widget.style.height = `${height}px`;

        let html = '';
        let headerText = '';

        if (type === 'calendar') {
            headerText = "📅 Today's Schedule";
            if (!data || data.length === 0) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="No events scheduled"></div></div>`;
            } else {
                data.forEach(ev => {
                    const title = ev.summary || 'Busy';
                    const time = ev.timeStr || 'All Day';
                    html += `
                    <div class="hud-item">
                        <div class="hud-item-title decrypt-target" data-text="${title.replace(/"/g, '&quot;')}"></div>
                        <div class="hud-item-meta decrypt-target" data-text="${time}"></div>
                    </div>`;
                });
            }
        } 
        else if (type === 'news') {
            headerText = "📰 Top Briefing";
            if (!data || data.length === 0) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="No news available"></div></div>`;
            } else {
                data.forEach(news => {
                    html += `
                    <div class="hud-item">
                        <div class="hud-item-title decrypt-target" data-text="${news.title.replace(/"/g, '&quot;')}"></div>
                        <div class="hud-item-meta decrypt-target" data-text="${news.source}"></div>
                    </div>`;
                });
            }
        }
        else if (type === 'weather') {
            headerText = "🌤️ Local Environment";
            html += `
            <div class="hud-item">
                <div class="hud-item-title decrypt-target" data-text="${data.temp || ''}°C - ${data.condition || ''}"></div>
                <div class="hud-item-meta decrypt-target" data-text="${data.location || ''}"></div>
            </div>`;
        }
        else if (type === 'welcome') {
             headerText = "SYSTEM ONLINE";
             html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="${data.message || 'Good morning, Sir.'}"></div></div>`;
        }
        else if (type === 'mermaid') {
            headerText = "📊 Workflow Diagram";
            
            // Generate HTML for each diagram in the data array
            const safeData = Array.isArray(data) ? data : (data ? [data] : []);
            html += `<div style="display: flex; flex-direction: row; flex-wrap: wrap; gap: 20px; justify-content: center; width: 100%;">`;
            safeData.forEach((item, index) => {
                const itemMermaidId = 'mermaid-' + widgetId + '-' + index;
                html += `
                <div class="hud-item" style="flex: 1 1 400px; background: rgba(255,255,255,0.05); min-height: 300px; display: flex; justify-content: center; align-items: center; overflow: auto; padding: 20px;">
                    <div id="${itemMermaidId}" style="width: 100%; height: 100%; display: flex; justify-content: center;"></div>
                </div>`;
            });
            html += `</div>`;
            
            // Render mermaid diagrams asynchronously
            setTimeout(async () => {
                mermaid.initialize({ startOnLoad: false, theme: 'dark' });
                for (let i = 0; i < safeData.length; i++) {
                    const item = safeData[i];
                    const itemMermaidId = 'mermaid-' + widgetId + '-' + i;
                    const mermaidEl = document.getElementById(itemMermaidId);
                    
                    let contentToRender = typeof item === 'string' ? item : (item.content || item.code || item.mermaid || '');
                    
                    // Strip markdown wrapping if the AI accidentally included it
                    if (contentToRender.includes('```')) {
                        contentToRender = contentToRender.replace(/```mermaid\n?/gi, '').replace(/```\n?/g, '').trim();
                    }

                    if (mermaidEl && contentToRender) {
                        try {
                            const { svg } = await mermaid.render('graph-' + widgetId + '-' + i, contentToRender);
                            mermaidEl.innerHTML = svg;
                        } catch (e) {
                            console.error('Mermaid render error:', e);
                            mermaidEl.innerHTML = `<div style="color:red; font-family: Inter, sans-serif;">Failed to render diagram</div>`;
                        }
                    }
                }
            }, 100);
        }
        else if (type === 'image_gallery') {
            headerText = data.title || '📸 Visual';
            zoneKey = 'top'; // Display in a wider top zone for slider
            const sliderId = 'slider-' + widgetId;
            const trackId = 'track-' + widgetId;
            const navId = 'nav-' + widgetId;
            
            html += `
            <div class="hud-image-slider" id="${sliderId}">
                <div class="hud-slider-track" id="${trackId}"></div>
                <div class="hud-slider-nav" id="${navId}"></div>
            </div>`;

            // Async load images after widget is in the DOM
            const loadImages = async () => {
                const track = document.getElementById(trackId);
                const nav = document.getElementById(navId);
                if (!track || !nav) return;
                
                let slideIndex = 0;
                let numSlides = 0;

                for (let i = 0; i < (data.images || []).length; i++) {
                    const img = data.images[i];
                    const slideEl = document.createElement('div');
                    slideEl.className = 'hud-slider-slide';
                    
                    const imgEl = document.createElement('img');
                    imgEl.className = 'hud-memory-thumb';
                    imgEl.title = img.label || '';
                    imgEl.alt = img.label || '';

                    if (img.publicUrl) {
                        imgEl.src = img.publicUrl;
                    } else if (img.source === 'memory' && img.filename) {
                        try {
                            const dataUrl = await window.liveAPI.readLocalImage(img.filename);
                            if (dataUrl) imgEl.src = dataUrl;
                        } catch (e) { /* silent */ }
                    } else if (img.url) {
                        imgEl.src = img.url;
                    }
                    
                    imgEl.onerror = () => {
                        imgEl.style.display = 'none';
                        const err = document.createElement('div');
                        err.style.color = '#ef4444';
                        err.style.padding = '20px';
                        err.style.textAlign = 'center';
                        err.style.fontSize = '12px';
                        err.textContent = '⚠️ Image unavailable (404)';
                        slideEl.insertBefore(err, imgEl);
                    };
                    
                    slideEl.appendChild(imgEl);

                    if (img.credit || img.label) {
                        const credit = document.createElement('div');
                        credit.className = 'hud-img-credit';
                        credit.textContent = img.credit || img.label;
                        slideEl.appendChild(credit);
                    }

                    // Click to expand fullscreen
                    imgEl.addEventListener('click', () => {
                        const overlay = document.getElementById('imgFullscreenOverlay');
                        const fullImg = document.getElementById('imgFullscreenEl');
                        if (overlay && fullImg) {
                            fullImg.src = img.fullUrl || img.url || imgEl.src;
                            overlay.style.display = 'flex';
                        }
                    });

                    track.appendChild(slideEl);
                    
                    // Add dot
                    const dot = document.createElement('div');
                    dot.className = i === 0 ? 'slider-dot active' : 'slider-dot';
                    dot.addEventListener('click', () => goToSlide(i));
                    nav.appendChild(dot);
                    numSlides++;
                }
                
                // Slider logic
                let slideInterval;
                const updateSlider = () => {
                    track.style.transform = `translateX(-${slideIndex * 100}%)`;
                    Array.from(nav.children).forEach((dot, idx) => {
                        dot.className = idx === slideIndex ? 'slider-dot active' : 'slider-dot';
                    });
                };
                
                const nextSlide = () => {
                    slideIndex = (slideIndex + 1) % numSlides;
                    updateSlider();
                };
                
                const goToSlide = (idx) => {
                    slideIndex = idx;
                    updateSlider();
                    resetInterval();
                };
                
                const resetInterval = () => {
                    clearInterval(slideInterval);
                    if (numSlides > 1) {
                        slideInterval = setInterval(nextSlide, 4500);
                    }
                };
                
                if (numSlides > 1) {
                    slideInterval = setInterval(nextSlide, 4500);
                    const slider = document.getElementById(sliderId);
                    if (slider) {
                        slider.addEventListener('mouseenter', () => clearInterval(slideInterval));
                        slider.addEventListener('mouseleave', () => resetInterval());
                    }
                }
            };
            setTimeout(loadImages, 150);
        }
        else if (type === 'emails') {
            headerText = "📩 Email Inbox";
            if (!data || data.length === 0) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="No new emails"></div></div>`;
            } else {
                data.forEach(email => {
                    const sender = email.from || 'Unknown Sender';
                    const subject = email.subject || 'No Subject';
                    html += `
                    <div class="hud-item">
                        <div class="hud-item-title decrypt-target" data-text="${sender.replace(/"/g, '&quot;')}"></div>
                        <div class="hud-item-meta decrypt-target" data-text="${subject.replace(/"/g, '&quot;')}"></div>
                    </div>`;
                });
            }
        }
        else if (type === 'agent_progress') {
            const sid = data.sessionId || 'default';
            if (!this.activeAgentLogs) this.activeAgentLogs = new Map();
            if (!this.activeAgentLogs.has(sid)) this.activeAgentLogs.set(sid, []);
            
            const logArr = this.activeAgentLogs.get(sid);
            const msg = data.message || 'Working...';
            if (logArr.length === 0 || logArr[logArr.length - 1] !== msg) {
                logArr.push(msg);
            }
            
            const recentLogs = logArr.slice(-5);
            const pct = data.percent ?? 0;
            const barColor = data.failed ? '#ef4444' : (data.done ? '#10b981' : '#c084fc');
            const glowColor = data.failed ? 'rgba(239, 68, 68, 0.6)' : (data.done ? 'rgba(16, 185, 129, 0.6)' : 'rgba(192, 132, 252, 0.6)');
            const isRunning = !data.done && !data.failed;

            // ─── In-place update: find existing widget and patch it ───
            const existingWidget = container.querySelector('.agent-progress-live');
            if (existingWidget) {
                // Update logs
                const logsEl = existingWidget.querySelector('.ap-logs');
                if (logsEl) logsEl.innerHTML = this._buildAgentLogs(recentLogs, barColor);
                // Update bar
                const barFill = existingWidget.querySelector('.ap-bar-fill');
                if (barFill) {
                    barFill.style.width = `${pct}%`;
                    barFill.style.background = `linear-gradient(90deg, ${barColor}aa, ${barColor})`;
                    barFill.style.boxShadow = `0 0 12px ${glowColor}, 0 0 4px ${glowColor}`;
                }
                // Update percent text
                const pctEl = existingWidget.querySelector('.ap-pct');
                if (pctEl) pctEl.textContent = `${pct}%`;
                // Update status label
                const statusEl = existingWidget.querySelector('.ap-status');
                if (statusEl) {
                    statusEl.textContent = data.failed ? 'TASK FAILED' : (data.done ? 'TASK COMPLETED' : 'PROCESSING...');
                    statusEl.style.color = barColor;
                    statusEl.style.textShadow = `0 0 10px ${glowColor}`;
                }
                // Update elapsed time
                if (!this._agentStartTime) this._agentStartTime = Date.now();
                const elapsed = Math.floor((Date.now() - this._agentStartTime) / 1000);
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                const timeEl = existingWidget.querySelector('.ap-elapsed');
                if (timeEl) timeEl.textContent = `${mins}m ${secs}s`;
                // Show/hide abort button
                const abortBtn = existingWidget.querySelector('.ap-abort-btn');
                if (abortBtn) abortBtn.style.display = isRunning ? 'block' : 'none';
                return; // Skip the full widget rebuild below
            }

            // ─── First render: create the widget ───
            this._agentStartTime = Date.now();
            headerText = "⚡ " + (data.display_name || "Domain Agent");

            html += `
                <div class="agent-progress-live" style="min-width: 360px; max-width: 450px; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(192, 132, 252, 0.2); padding: 18px; border-radius: 12px; backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <div>
                            <span class="ap-status" style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${barColor}; text-shadow: 0 0 10px ${glowColor};">
                                PROCESSING...
                            </span>
                            <span class="ap-elapsed" style="font-size: 10px; color: #64748b; margin-left: 10px; font-family: 'Inter', monospace;">0m 0s</span>
                        </div>
                        <button class="ap-abort-btn" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5; padding: 6px 14px; border-radius: 6px; font-size: 11px; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.2s ease; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; display: ${isRunning ? 'block' : 'none'};"
                            onmouseover="this.style.background='rgba(239, 68, 68, 0.3)'; this.style.boxShadow='0 0 12px rgba(239, 68, 68, 0.5)';"
                            onmouseout="this.style.background='rgba(239, 68, 68, 0.15)'; this.style.boxShadow='none';">
                            ✕ Abort
                        </button>
                    </div>
                    
                    <div class="ap-logs" style="margin-bottom: 16px; min-height: 60px;">
                        ${this._buildAgentLogs(recentLogs, barColor)}
                    </div>
                    
                    <div style="display: flex; justify-content: flex-end; align-items: flex-end; margin-bottom: 8px;">
                        <div class="ap-pct" style="font-size: 16px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
                            ${pct}%
                        </div>
                    </div>
                    
                    <div style="height: 6px; background: rgba(0,0,0,0.6); border-radius: 6px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); position: relative;">
                        <div class="ap-bar-fill" style="position: absolute; left: 0; top: 0; height: 100%; width: ${pct}%; background: linear-gradient(90deg, ${barColor}aa, ${barColor}); border-radius: 6px; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 0 12px ${glowColor}, 0 0 4px ${glowColor};"></div>
                    </div>
                </div>`;

            // Attach abort click listener after DOM insertion
            setTimeout(() => {
                const abortBtn = container.querySelector('.ap-abort-btn');
                if (abortBtn && !abortBtn._bound) {
                    abortBtn._bound = true;
                    abortBtn.addEventListener('click', async () => {
                        abortBtn.textContent = '⏳ Killing...';
                        abortBtn.style.opacity = '0.5';
                        abortBtn.style.pointerEvents = 'none';
                        if (window.liveAPI && window.liveAPI.cancelAgents) {
                            await window.liveAPI.cancelAgents();
                        }
                    });
                }
            }, 100);
        }
        else if (type === 'full-email') {
            headerText = "✉️ Email Content";
            if (!data) {
                html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="Email unavailable"></div></div>`;
            } else {
                html += `
                <div class="hud-item" style="max-height: 400px; overflow-y: auto; background: rgba(255,255,255,0.05);">
                    <div style="font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.5; color: #f8fafc;">${data}</div>
                </div>`;
            }
        }
        else {
             // Fallback for older types
             headerText = "💡 Information";
             html += `<div class="hud-item"><div class="hud-item-title decrypt-target" data-text="Data Received"></div></div>`;
        }

        // Apply dynamic colors based on zone/type
        let themeColor = '#06b6d4'; // default cyan
        if (zoneKey === 'left') themeColor = '#c084fc'; // Purple for memory/news
        if (zoneKey === 'right') themeColor = '#00e5ff'; // Bright cyan for environment
        if (zoneKey === 'bottom') themeColor = '#fbbf24'; // Gold for schedule
        if (zoneKey === 'top') themeColor = '#10b981'; // Emerald for status
        
        widget.style.setProperty('--theme-color', themeColor);

        widget.innerHTML = `
            <div class="hud-widget-header decrypt-target" data-text="${headerText}"></div>
            ${html}
        `;

        container.appendChild(widget);
        this.addTiltEffect(widget);
        this.drawNeuralLine(widget, themeColor);

        // Run decryption and kinetic staggering
        setTimeout(() => {
            const decryptTargets = widget.querySelectorAll('.decrypt-target');
            decryptTargets.forEach(el => {
                this.decryptText(el, el.getAttribute('data-text'));
            });
            
            // Apply animation stagger for kinetic flow
            const hudItems = widget.querySelectorAll('.hud-item');
            hudItems.forEach((item, idx) => {
                item.style.animationDelay = `${idx * 0.12}s`;
            });
            
            // Image load staggering
            const imgWrappers = widget.querySelectorAll('.hud-img-wrapper');
            imgWrappers.forEach((img, idx) => {
                img.style.animationDelay = `${idx * 0.15}s`;
            });
        }, 50);

        // Auto-hide
        let timeoutDuration = 25000;
        if (type === 'youtube') timeoutDuration = 180000;
        else if (type === 'mermaid') timeoutDuration = 300000; // 5 mins
        else if (type === 'agent_progress') timeoutDuration = data?.done || data?.failed ? 12000 : 600000;
        
        const timeout = setTimeout(() => {
            if(document.getElementById(widgetId)) {
                widget.style.opacity = '0';
                widget.style.transform = 'translateY(-20px) scale(0.9)';
                const path = document.getElementById(`path-${widgetId}`);
                if (path) path.style.opacity = '0';
                setTimeout(() => {
                    widget.remove();
                    if (path) path.remove();
                }, 500);
            }
        }, timeoutDuration);
        this.activeTimeouts.set(widgetId, timeout);
    }
}

const hudManager = new WidgetManager();

module.exports = { WidgetManager, hudManager };
});
