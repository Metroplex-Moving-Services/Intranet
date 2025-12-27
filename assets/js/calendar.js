/* ============================================================
   assets/js/calendar.js
   Handles Descope Auth, Zoho Data Fetching, and FullCalendar
   ============================================================ */

const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });
const NETLIFY_GET_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/get-calendar";
const NETLIFY_ADD_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/add-mover-to-job";

document.addEventListener('DOMContentLoaded', async function() {
    
    // --- STALE DATA TIMER (1 Hour) ---
    const STALE_THRESHOLD = 60 * 60 * 1000; 
    const startTime = new Date().getTime();
    setInterval(function() {
        if ((new Date().getTime() - startTime) > STALE_THRESHOLD) {
            const btn = document.getElementById("staleDataBtn");
            if(btn) btn.style.display = "inline-block"; 
        }
    }, 60000); 
    // ------------------------------------------

    const sessionToken = sdk.getSessionToken();
    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        window.top.location.href = "/Intranet/login.html";
    } else {
        initCalendar(sessionToken);
    }
});

let calendarInstance = null;
let currentAuthToken = null;

function initCalendar(authToken) {
    currentAuthToken = authToken;
    const loadingMsg = document.getElementById('loading');
    
    // Only show loading text if calendar isn't already visible (first load)
    if (!calendarInstance) {
        loadingMsg.innerText = "Loading calendar data...";
        loadingMsg.style.display = 'block';
    } else {
        // Optional: Show a subtle loading indicator for refreshes?
        // loadingMsg.innerText = "Refreshing...";
        // loadingMsg.style.display = 'block';
    }

    const calendarEl = document.getElementById('calendar');

    fetchCalendarData(authToken)
    .then(records => {
        loadingMsg.style.display = 'none';
        renderCalendar(calendarEl, records);
    })
    .catch(err => {
        loadingMsg.innerHTML = `<span style='color:red'><strong>Error:</strong> ${err.message}</span>`;
        console.error("Init Error:", err);
    });
}

function fetchCalendarData(token) {
    return fetch(NETLIFY_GET_ENDPOINT, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(async response => {
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Server Error: ${response.status}`);
        }
        return response.json();
    })
    .then(data => data.data || []);
}

function renderCalendar(calendarEl, records) {
    var calendarEvents = mapRecordsToEvents(records);

    // If calendar already exists, just update the events and return
    // This prevents the UI from "flashing" or resetting the view unnecessarily
    if (calendarInstance) {
        calendarInstance.removeAllEvents();
        calendarInstance.addEventSource(calendarEvents);
        return;
    }

    calendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        eventDisplay: 'block', 
        height: 'auto',
        customButtons: {
            resetToday: {
                text: 'Today',
                click: function() {
                    // 1. Move view to Today
                    calendarInstance.today();
                    
                    // 2. Clear selection styles
                    document.querySelectorAll('.selected-day').forEach(el => el.classList.remove('selected-day'));
                    updateTodayButton(false);

                    // 3. FORCE REFRESH: Pull fresh data from Zoho
                    console.log("Refreshing data...");
                    initCalendar(currentAuthToken);
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
            updateTodayButton(true);
        },
        eventClick: function(info) {
            info.jsEvent.preventDefault(); 
            openJobPopup(info.event);
            refreshSingleJobData(info.event);
        }
    });
    calendarInstance.render();
}

// --- INTELLIGENT JOB REFRESH ---
async function refreshSingleJobData(calendarEvent) {
    const jobId = calendarEvent.extendedProps.id;
    
    const teamContainer = document.getElementById(`team-container-${jobId}`);
    if(teamContainer) {
        teamContainer.innerHTML += ` <span style="font-size:0.8em; color:#888;">(Checking for updates...)</span>`;
    }

    try {
        const freshRecords = await fetchCalendarData(currentAuthToken);
        const freshRecord = freshRecords.find(r => r.ID === jobId);

        if (freshRecord) {
            const dummyEvent = mapRecordsToEvents([freshRecord])[0]; 
            
            calendarEvent.setProp('backgroundColor', dummyEvent.backgroundColor);
            calendarEvent.setProp('borderColor', dummyEvent.borderColor);
            calendarEvent.setExtendedProp('team', dummyEvent.extendedProps.team);
            calendarEvent.setExtendedProp('actualCount', dummyEvent.extendedProps.actualCount);
            calendarEvent.setExtendedProp('moverCount', dummyEvent.extendedProps.moverCount);
            
            const openPopupId = document.getElementById(`popup-job-id-${jobId}`);
            if (openPopupId) {
                updatePopupContentInPlace(calendarEvent);
            }
        }
    } catch (err) {
        console.error("Background refresh failed", err);
    }
}

function updatePopupContentInPlace(eventObj) {
    const props = eventObj.extendedProps;
    const start = eventObj.start;
    const end = eventObj.end;
    
    var parentRole = (window.parent && window.parent.userRole) ? window.parent.userRole : [];
    var isHoobastank = parentRole.includes("Hoobastank");
    var needsMover = props.actualCount < props.moverCount;
    var isFuture = start > new Date();
    var showAddButton = isHoobastank && needsMover && isFuture;

    const htmlContent = generatePopupHtml(props, start, end, showAddButton);
    
    const contentContainer = Swal.getHtmlContainer();
    if(contentContainer) {
        contentContainer.innerHTML = htmlContent;
        attachAddMeListener(eventObj); 
    }
}

// --- DATA MAPPING ---
function mapRecordsToEvents(records) {
    return records.map(function(record) {
        var startRaw = record.Agreed_Start_Date_Time;
        var endRaw = record.Estimate_End_Date_Time;
        var startISO = parseZohoDate(startRaw);
        var endISO = parseZohoDate(endRaw);
        
        if (!endISO && startRaw && endRaw) {
            try {
                var dateOnly = startRaw.trim().split(/\s+/)[0]; 
                var combined = dateOnly + " " + endRaw;
                endISO = parseZohoDate(combined);
            } catch(e) {}
        }
        
        if (!startISO) return null;

        var safeName = getZohoVal(record.Customer_Name) || "Unknown";
        var requiredCount = parseInt(record.Mover_Count) || 0; 
        var actualMoversCount = countMovers(record.Movers2); 
        var servicesRaw = getZohoVal(record.Services_Provided);

        var bgColor = '#0C419a'; 
        var bdColor = '#0C419a';
        if (servicesRaw && servicesRaw.toLowerCase().includes("pending")) {
            bgColor = '#28a745'; bdColor = '#28a745'; 
        } else if (actualMoversCount < requiredCount) {
            bgColor = '#fd7e14'; bdColor = '#fd7e14'; 
        }

        return {
            title: getShortName(safeName), 
            start: startISO, 
            end: endISO,
            backgroundColor: bgColor, 
            borderColor: bdColor, 
            textColor: '#ffffff',
            extendedProps: { 
                id: record.ID, 
                name: safeName, 
                origin: record.Origination_Address, 
                destination: record.Destination_Address,
                services: servicesRaw, 
                team: getMoversString(record.Movers2),
                moverCount: requiredCount,
                actualCount: actualMoversCount 
            }
        };
    }).filter(event => event !== null);
}

// --- POPUP LOGIC ---
function openJobPopup(eventObj) {
    const props = eventObj.extendedProps;
    const start = eventObj.start;
    const end = eventObj.end;
    
    var parentRole = (window.parent && window.parent.userRole) ? window.parent.userRole : [];
    var isHoobastank = parentRole.includes("Hoobastank");
    var needsMover = props.actualCount < props.moverCount;
    var isFuture = start > new Date();
    var showAddButton = isHoobastank && needsMover && isFuture;

    const htmlContent = generatePopupHtml(props, start, end, showAddButton);

    Swal.fire({
        title: props.name,
        width: 600,
        showCloseButton: true,
        showConfirmButton: false, 
        html: htmlContent,
        didOpen: () => {
            attachAddMeListener(eventObj);
        }
    });
}

function generatePopupHtml(props, start, end, showAddButton) {
    var dateStr = formatPopupDate(start);
    var startTimeStr = formatPopupTime(start);
    var endTimeStr = end ? formatPopupTime(end) : "Unknown";
    var fullTimeHeader = `${dateStr}, ${startTimeStr} - ${endTimeStr}`;

    var originDisplay = getDisplayAddr(props.origin);
    var destDisplay   = getDisplayAddr(props.destination);
    var originLink    = getMapLink(props.origin);
    var destLink      = getMapLink(props.destination);

    var addMeBtnHtml = "";
    if (showAddButton) {
        addMeBtnHtml = `
            <button id="btn-add-me" style="margin-left: 10px; background-color: #28a745; color: white; border: none; border-radius: 4px; padding: 3px 8px; font-size: 0.85em; font-weight: bold; cursor: pointer; vertical-align: middle;">
                Add Me
            </button>
        `;
    }

    const hiddenIdCheck = `<div id="popup-job-id-${props.id}" style="display:none;"></div>`;

    return `
        ${hiddenIdCheck}
        <div id="popup-content-container" style="text-align: left; font-size: 1.1em;">
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

            <div id="team-container-${props.id}" style="margin-top: 5px; color: #333; font-weight: 500;">
                ${props.team || "None assigned"}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.9em;">
                Target Size: <strong>${props.moverCount || 0} Movers</strong>
            </div>
        </div>
    `;
}

function attachAddMeListener(eventObj) {
    const btn = document.getElementById('btn-add-me');
    if (btn) {
        btn.addEventListener('click', () => {
            const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
            const niceDate = eventObj.start.toLocaleDateString('en-US', dateOptions);
            const niceTime = formatPopupTime(eventObj.start);
            const niceEnd  = eventObj.end ? formatPopupTime(eventObj.end) : "?";

            const popup = Swal.getPopup();
            const overlayHtml = `
                <div id="confirm-overlay" style="
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(255,255,255,0.95); z-index: 1000; 
                    display: flex; flex-direction: column; justify-content: center; align-items: center; 
                    text-align: center; border-radius: 5px; animation: fadeIn 0.2s;
                ">
                    <h3 style="margin: 0 0 10px 0; color: #333;">Are you sure?</h3>
                    <p style="margin-bottom: 25px; color: #555; padding: 0 20px; font-size: 1.1em;">
                        The job is on <strong>${niceDate}</strong><br>${niceTime} - ${niceEnd}
                    </p>
                    <div style="display: flex; gap: 10px;">
                        <button id="btn-confirm-yes" class="btn btn-success" style="background-color:#28a745; color:white; border:none; padding:10px 20px;">Yes, I'm In</button>
                        <button id="btn-confirm-no" class="btn btn-danger" style="background-color:#d33; color:white; border:none; padding:10px 20px;">Cancel</button>
                    </div>
                </div>
            `;
            
            const overlayDiv = document.createElement('div');
            overlayDiv.innerHTML = overlayHtml;
            popup.style.position = 'relative';
            popup.appendChild(overlayDiv);

            document.getElementById('btn-confirm-yes').addEventListener('click', async () => {
                overlayDiv.innerHTML = `<h3 style="color:#0C419a;">Adding you to job...</h3>`;

                try {
                    let userEmail = null;
                    const parentUser = window.parent.user;
                    
                    if (parentUser) {
                        if (parentUser.data && parentUser.data.email) {
                            userEmail = parentUser.data.email;
                        } else if (parentUser.email) {
                            userEmail = parentUser.email;
                        } else if (parentUser.data && parentUser.data.loginIds && parentUser.data.loginIds.length > 0) {
                            userEmail = parentUser.data.loginIds[0];
                        }
                    }

                    if(!userEmail) throw new Error("Could not find user email.");

                    const apiResponse = await fetch(NETLIFY_ADD_ENDPOINT, {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${currentAuthToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            jobId: eventObj.extendedProps.id, 
                            email: userEmail
                        })
                    });

                    if(!apiResponse.ok) {
                        const errText = await apiResponse.text();
                        try {
                            const errObj = JSON.parse(errText);
                            throw new Error(errObj.error || errObj.message || "Update failed");
                        } catch(e) {
                            throw new Error(errText || "Update failed");
                        }
                    }

                    overlayDiv.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <div style="font-size: 50px; color: #28a745;">✓</div>
                            <h2 style="color: #555; margin: 0;">Added!</h2>
                        </div>
                    `;

                    setTimeout(() => {
                        overlayDiv.remove(); 
                        refreshSingleJobData(eventObj); 
                    }, 1000); 

                } catch (err) {
                    console.error(err);
                    overlayDiv.innerHTML = `
                        <div style="padding:20px;">
                            <h3 style="color:red;">Error</h3>
                            <p>${err.message}</p>
                            <button id="btn-error-close" class="btn btn-default" style="margin-top:10px;">Close</button>
                        </div>
                    `;
                    document.getElementById('btn-error-close').addEventListener('click', () => Swal.close());
                }
            });

            document.getElementById('btn-confirm-no').addEventListener('click', () => {
                overlayDiv.remove();
            });
        });
    }
}

// --- HELPERS (Unchanged) ---
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

function getDisplayAddr(addrObj) {
    if (!addrObj) return "Unknown";
    if (typeof addrObj === 'string') return addrObj;
    let parts = [];
    if (addrObj.address_line_1) parts.push(addrObj.address_line_1);
    if (addrObj.address_line_2) parts.push(addrObj.address_line_2);
    if (addrObj.district_city)  parts.push(addrObj.district_city);
    return parts.join(", ");
}

function getMapLink(addrObj) {
    if (!addrObj) return "#";
    var mapAddr = "";
    if (typeof addrObj === 'string') mapAddr = addrObj;
    else {
        let parts = [];
        if (addrObj.address_line_1) parts.push(addrObj.address_line_1);
        if (addrObj.district_city)  parts.push(addrObj.district_city);
        if (addrObj.state_province) parts.push(addrObj.state_province);
        if (addrObj.postal_code)    parts.push(addrObj.postal_code);
        mapAddr = parts.join(", ");
    }
    
    var isApple = /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
    return isApple ? 
        "http://maps.apple.com/?daddr=" + encodeURIComponent(mapAddr) + "&dirflg=d" : 
        "https://www.google.com/maps?daddr=" + encodeURIComponent(mapAddr) + "&dirflg=t";
}