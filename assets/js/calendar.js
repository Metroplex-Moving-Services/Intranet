/* ============================================================
   assets/js/calendar.js
   Handles Descope Auth, Zoho Data Fetching, and FullCalendar
   ============================================================ */

// 1. Initialize Descope
const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });

document.addEventListener('DOMContentLoaded', async function() {
    
    // --- FEATURE: STALE DATA TIMER (1 Hour) ---
    const STALE_THRESHOLD = 60 * 60 * 1000; 
    const startTime = new Date().getTime();
    setInterval(function() {
        if ((new Date().getTime() - startTime) > STALE_THRESHOLD) {
            const btn = document.getElementById("staleDataBtn");
            if(btn) btn.style.display = "inline-block"; 
        }
    }, 60000); 
    // ------------------------------------------

    // 2. Check Auth Token
    const sessionToken = sdk.getSessionToken();

    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        window.top.location.href = "/Intranet/login.html";
    } else {
        initCalendar(sessionToken);
    }
});

function initCalendar(authToken) {
    const loadingMsg = document.getElementById('loading');
    loadingMsg.innerText = "Loading calendar data...";
    const calendarEl = document.getElementById('calendar');
    const NETLIFY_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/get-calendar";

    // --- FETCH DATA ---
    fetch(NETLIFY_ENDPOINT, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(async response => {
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Server Error: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Received HTML instead of JSON. Check Network Tab.");
        }
        return response.json();
    })
    .then(data => {
        loadingMsg.style.display = 'none';

        const records = data.data || []; 
        
        if (records.length === 0) {
             console.warn("No events returned from Zoho.");
        }

        var calendarEvents = records.map(function(record) {
            var startRaw = record.Agreed_Start_Date_Time;
            var endRaw = record.Estimate_End_Date_Time;

            var startISO = parseZohoDate(startRaw);
            var endISO = parseZohoDate(endRaw);
            
            // Fallback logic for end dates
            if (!endISO && startRaw && endRaw) {
                try {
                    var dateOnly = startRaw.trim().split(/\s+/)[0]; 
                    var combined = dateOnly + " " + endRaw;
                    endISO = parseZohoDate(combined);
                } catch(e) {}
            }
            
            if (!startISO) return null;

            var safeName = getZohoVal(record.Customer_Name) || "Unknown";
            var shortName = getShortName(safeName);
            var originObj = record.Origination_Address; 
            var destObj = record.Destination_Address;
            var servicesRaw = getZohoVal(record.Services_Provided);
            
            var requiredCount = parseInt(record.Mover_Count) || 0; 
            var actualMoversCount = countMovers(record.Movers2); 
            var moversListString = getMoversString(record.Movers2);

            var bgColor = '#0C419a'; 
            var bdColor = '#0C419a';
            if (servicesRaw && servicesRaw.toLowerCase().includes("pending")) {
                bgColor = '#28a745'; bdColor = '#28a745';
            } else if (actualMoversCount < requiredCount) {
                bgColor = '#fd7e14'; bdColor = '#fd7e14';
            }

            return {
                title: shortName, start: startISO, end: endISO,
                backgroundColor: bgColor, borderColor: bdColor, textColor: '#ffffff',
                extendedProps: { 
                    name: safeName, 
                    origin: originObj, 
                    destination: destObj,
                    services: servicesRaw, 
                    team: moversListString,
                    moverCount: requiredCount,
                    actualCount: actualMoversCount 
                }
            };
        }).filter(event => event !== null);

        // --- RENDER FULLCALENDAR (V5) ---
        var calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            eventDisplay: 'block', 
            height: 'auto',
            customButtons: {
                resetToday: {
                    text: 'Today',
                    click: function() {
                        calendar.today();
                        document.querySelectorAll('.selected-day').forEach(el => el.classList.remove('selected-day'));
                        var todayEl = document.querySelector('.fc-day-today');
                        if (todayEl) todayEl.style.backgroundColor = '';
                        updateTodayButton(false);
                    }
                }
            },
            headerToolbar: { left: 'title', center: '', right: 'prev,next resetToday' },
            events: calendarEvents,
            datesSet: function(info) {
                var today = new Date(); today.setHours(0,0,0,0);
                if (today >= info.start && today < info.end) updateTodayButton(false);
                else updateTodayButton(true);
            },
            dateClick: function(info) {
                document.querySelectorAll('.selected-day').forEach(el => el.classList.remove('selected-day'));
                info.dayEl.classList.add('selected-day');
                var todayEl = document.querySelector('.fc-day-today');
                if (todayEl) todayEl.style.backgroundColor = 'transparent';
                updateTodayButton(true);
            },
            eventClick: function(info) {
                info.jsEvent.preventDefault(); 
                var props = info.event.extendedProps;
                
                var dateStr = formatPopupDate(info.event.start);
                var startTimeStr = formatPopupTime(info.event.start);
                var endTimeStr = info.event.end ? formatPopupTime(info.event.end) : "Unknown";
                var fullTimeHeader = `${dateStr}, ${startTimeStr} - ${endTimeStr}`;
                
                // Address Helpers
                function getDisplayAddr(addrObj) {
                    if (!addrObj) return "Unknown";
                    if (typeof addrObj === 'string') return addrObj;
                    let parts = [];
                    if (addrObj.address_line_1) parts.push(addrObj.address_line_1);
                    if (addrObj.address_line_2) parts.push(addrObj.address_line_2);
                    if (addrObj.district_city)  parts.push(addrObj.district_city);
                    return parts.join(", ");
                }

                function getMapAddr(addrObj) {
                    if (!addrObj) return "";
                    if (typeof addrObj === 'string') return addrObj;
                    let parts = [];
                    if (addrObj.address_line_1) parts.push(addrObj.address_line_1);
                    if (addrObj.district_city)  parts.push(addrObj.district_city);
                    if (addrObj.state_province) parts.push(addrObj.state_province);
                    if (addrObj.postal_code)    parts.push(addrObj.postal_code);
                    return parts.join(", ");
                }

                var originDisplay = getDisplayAddr(props.origin);
                var destDisplay   = getDisplayAddr(props.destination);
                var originMapStr  = getMapAddr(props.origin);
                var destMapStr    = getMapAddr(props.destination);
                
                var isApple = /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
                var originLink = isApple ? "http://maps.apple.com/?daddr=" + encodeURIComponent(originMapStr) + "&dirflg=d" : "https://www.google.com/maps?daddr=" + encodeURIComponent(originMapStr) + "&dirflg=t";
                var destLink = isApple ? "http://maps.apple.com/?daddr=" + encodeURIComponent(destMapStr) + "&dirflg=d" : "https://www.google.com/maps?daddr=" + encodeURIComponent(destMapStr) + "&dirflg=t";

                // --- ADD ME BUTTON LOGIC ---
                var parentRole = (window.parent && window.parent.userRole) ? window.parent.userRole : [];
                var isHoobastank = parentRole.includes("Hoobastank");
                var needsMover = props.actualCount < props.moverCount;
                
                // FIX 1: Check if the job is in the future
                var isFuture = info.event.start > new Date();

                // Create Inline Button HTML if conditions met
                var addMeBtnHtml = "";
                if (isHoobastank && needsMover && isFuture) {
                    addMeBtnHtml = `
                        <button id="btn-add-me" style="margin-left: 10px; background-color: #28a745; color: white; border: none; border-radius: 4px; padding: 3px 8px; font-size: 0.85em; font-weight: bold; cursor: pointer; vertical-align: middle;">
                            Add Me
                        </button>
                    `;
                }
                // ---------------------------

                Swal.fire({
                    title: props.name,
                    width: 600,
                    showCloseButton: true,
                    showConfirmButton: false, 
                    html: `
                        <div style="text-align: left; font-size: 1.1em;">
                            <div style="margin-bottom: 20px; font-weight: bold; font-size: 1.2em; color: #444; border-bottom: 2px solid #0C419a; padding-bottom: 10px;">
                                📅 ${fullTimeHeader}
                            </div>

                            <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
                                <strong style="min-width: 80px; color: #333; margin-right: 10px;">📍 Pickup:</strong>
                                <a href="${originLink}" target="_blank" class="popup-link" style="flex: 1; word-wrap: break-word; line-height: 1.4;">
                                    ${originDisplay}
                                </a>
                            </div>

                            <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                                <strong style="min-width: 80px; color: #333; margin-right: 10px;">🏁 Dropoff:</strong>
                                <a href="${destLink}" target="_blank" class="popup-link" style="flex: 1; word-wrap: break-word; line-height: 1.4;">
                                    ${destDisplay}
                                </a>
                            </div>

                            <hr style="border-top: 1px solid #eee; margin: 15px 0;">
                            <strong>🛠 Services Provided:</strong>
                            <div class="services-box" style="margin-top: 5px;">${props.services ? String(props.services).trim() : "No details."}</div>
                            <hr style="border-top: 1px solid #eee; margin: 15px 0;">
                            
                            <div style="margin-top: 5px;">
                                <strong>👥 Team:</strong> ${addMeBtnHtml}
                            </div>

                            <div style="margin-top: 5px; color: #333; font-weight: 500;">
                                ${props.team || "None assigned"}
                            </div>
                            <div style="margin-top: 4px; color: #666; font-size: 0.9em;">
                                Target Size: <strong>${props.moverCount || 0} Movers</strong>
                            </div>
                        </div>
                    `,
                    didOpen: () => {
                        // Attach Click Event
                        const btn = document.getElementById('btn-add-me');
                        if (btn) {
                            btn.addEventListener('click', () => {
                                // FIX 2: Do NOT call Swal.close() here.
                                // Calling Swal.fire again will naturally replace the current modal content
                                // without the visual flicker of closing and reopening.

                                // Date Format for Confirmation
                                const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
                                const niceDate = info.event.start.toLocaleDateString('en-US', dateOptions);
                                const niceTime = formatPopupTime(info.event.start);
                                const niceEnd  = info.event.end ? formatPopupTime(info.event.end) : "?";

                                Swal.fire({
                                    title: 'Are you sure?',
                                    text: `The job is on ${niceDate}, ${niceTime} - ${niceEnd}`,
                                    icon: 'question',
                                    showCancelButton: true,
                                    confirmButtonText: "Yes, I'm In",
                                    cancelButtonText: "Cancel",
                                    confirmButtonColor: '#28a745',
                                    cancelButtonColor: '#d33'
                                }).then((result) => {
                                    if (result.isConfirmed) {
                                        Swal.fire('Added!', 'You have been added to the job.', 'success');
                                    }
                                });
                            });
                        }
                    }
                });
            }
        });
        calendar.render();
    })
    .catch(err => {
        loadingMsg.innerHTML = `<span style='color:red'><strong>Error:</strong> ${err.message}</span>`;
        console.error("Full Error Details:", err);
    });
}

// --- HELPER FUNCTIONS ---
function parseZohoDate(dateStr) {
    if (!dateStr) return null;
    dateStr = dateStr.trim();
    const parts = dateStr.split(/\s+/); 
    const dateRaw = parts[0].replace(/\//g, '-');
    const dateParts = dateRaw.split('-'); 

    if (dateParts.length < 3) return null;

    let month = parseInt(dateParts[0], 10);
    let day   = parseInt(dateParts[1], 10);
    let year  = parseInt(dateParts[2], 10);
    if (year < 100) year += 2000;

    let hour = 0;
    let minute = 0;
    if (parts.length > 1) {
        const timeRaw = parts[1]; 
        const timeParts = timeRaw.split(':');
        hour = parseInt(timeParts[0], 10);
        minute = parseInt(timeParts[1], 10);
        if (parts.length > 2) {
            const meridian = parts[2].toUpperCase(); 
            if (meridian === "PM" && hour < 12) hour += 12;
            if (meridian === "AM" && hour === 12) hour = 0;
        }
    }
    const isoDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const isoTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
    return `${isoDate}T${isoTime}`;
}

function getZohoVal(field) { return (field && field.display_value) ? field.display_value : (field || ""); }

function getShortName(fullName) {
    if (!fullName) return "Unknown";
    var parts = fullName.trim().split(/\s+/); 
    if (parts.length === 1) return parts[0];
    return parts[0] + " " + parts[parts.length - 1].charAt(0) + ".";
}

function countMovers(moversField) {
    if (!moversField) return 0;
    if (Array.isArray(moversField)) return moversField.length; 
    if (typeof moversField === 'string') return moversField.trim() === "" ? 0 : moversField.split(',').length; 
    return 0; 
}

function getMoversString(moversField) {
    if (!moversField) return "None assigned";
    if (Array.isArray(moversField)) {
        return moversField.map(m => (m.display_value ? m.display_value : m)).join(", ");
    }
    return moversField;
}

function formatPopupTime(dateObj) {
    if (!dateObj) return "";
    return dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatPopupDate(dateObj) {
    if (!dateObj) return "";
    return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateTodayButton(shouldEnable) {
    var btn = document.querySelector('.fc-resetToday-button');
    if (btn) {
        btn.style.opacity = shouldEnable ? '1' : '0.5';
        btn.disabled = !shouldEnable;
        btn.style.cursor = shouldEnable ? 'pointer' : 'default';
    }
}