/* ============================================================
   assets/js/calendar.js
   Handles Descope Auth, Zoho Data Fetching, FullCalendar,
   Add Me Logic, and Clock-In Logic (v1.4.0 - Fixed Email Lookup)
   ============================================================ */

const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });
const NETLIFY_GET_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/get-calendar";
const NETLIFY_ADD_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/add-mover-to-job";
const NETLIFY_CLOCKIN_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/clock-in";

// --- INJECT CUSTOM STYLES ---
const style = document.createElement('style');
style.innerHTML = `
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .loader-spinner { border: 3px solid #f3f3f3; border-top: 3px solid #0C419a; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px; }
    .loader-spinner.small { width: 14px; height: 14px; border-width: 2px; }
    .loader-spinner.large { width: 40px; height: 40px; border-width: 5px; border-top-color: #28a745; margin-bottom: 10px; }
    
    .btn-add-me { background: linear-gradient(135deg, #28a745 0%, #218838 100%); color: white; border: none; border-radius: 50px; padding: 6px 16px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; cursor: pointer; margin-left: 10px; }
    .btn-add-me:hover { transform: translateY(-2px); box-shadow: 0 5px 12px rgba(40, 167, 69, 0.4); }

    /* CLOCK IN BUTTON STYLE */
    .btn-clock-in { background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; border: none; border-radius: 50px; padding: 6px 16px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; cursor: pointer; margin-left: 10px; display: inline-flex; align-items: center; gap: 5px; }
    .btn-clock-in:hover { transform: translateY(-2px); box-shadow: 0 5px 12px rgba(0, 123, 255, 0.4); background: linear-gradient(135deg, #0069d9 0%, #004085 100%); }
    .btn-clock-in:disabled { background: #ccc; cursor: not-allowed; transform: none; box-shadow: none; }
`;
document.head.appendChild(style);

let clockInTimer = null; // Store timer reference to clear it if popup closes

document.addEventListener('DOMContentLoaded', async function() {
    const STALE_THRESHOLD = 60 * 60 * 1000; 
    const startTime = new Date().getTime();
    setInterval(function() {
        if ((new Date().getTime() - startTime) > STALE_THRESHOLD) {
            const btn = document.getElementById("staleDataBtn");
            if(btn) btn.style.display = "inline-block"; 
        }
    }, 60000); 

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
    if (!calendarInstance) {
        loadingMsg.innerHTML = `<div class="loader-spinner"></div> Loading calendar data...`;
        loadingMsg.style.display = 'block';
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

function fetchCalendarData(token, specificJobId = null) {
    let url = NETLIFY_GET_ENDPOINT;
    const timestamp = new Date().getTime(); 
    if (specificJobId) url += `?id=${specificJobId}&_t=${timestamp}`; 
    else url += `?_t=${timestamp}`;

    return fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(async response => {
        if (!response.ok) { const text = await response.text(); throw new Error(`Server Error: ${response.status} - ${text}`); }
        return response.json();
    })
    .then(data => data.data || []);
}

function renderCalendar(calendarEl, records) {
    var calendarEvents = mapRecordsToEvents(records);
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
                    calendarInstance.today();
                    document.querySelectorAll('.selected-day').forEach(el => el.classList.remove('selected-day'));
                    updateTodayButton(false);
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

async function refreshSingleJobData(calendarEvent) {
    const jobId = calendarEvent.extendedProps.id;
    const spinnerId = `spinner-${jobId}`;
    const teamContainer = document.getElementById(`team-container-${jobId}`);
    if(teamContainer) {
        const oldSpinner = document.getElementById(spinnerId);
        if (oldSpinner) oldSpinner.remove();
        teamContainer.innerHTML += ` <div id="${spinnerId}" class="loader-spinner small" style="margin-left:5px; border-top-color:#888;"></div>`;
    }
    try {
        const freshRecords = await fetchCalendarData(currentAuthToken, jobId);
        const freshRecord = freshRecords.find(r => r.ID === jobId) || freshRecords[0];
        if (freshRecord && freshRecord.ID === jobId) {
            const dummyEvent = mapRecordsToEvents([freshRecord])[0]; 
            calendarEvent.setProp('backgroundColor', dummyEvent.backgroundColor);
            calendarEvent.setProp('borderColor', dummyEvent.borderColor);
            calendarEvent.setExtendedProp('team', dummyEvent.extendedProps.team);
            calendarEvent.setExtendedProp('actualCount', dummyEvent.extendedProps.actualCount);
            calendarEvent.setExtendedProp('moverCount', dummyEvent.extendedProps.moverCount);
            // Updated property assignment for emails
            calendarEvent.setExtendedProp('moverEmails', dummyEvent.extendedProps.moverEmails);
            
            const openPopupId = document.getElementById(`popup-job-id-${jobId}`);
            if (openPopupId) { updatePopupContentInPlace(calendarEvent); }
        }
    } catch (err) { console.error("Background refresh failed", err); } 
    finally { const spinner = document.getElementById(spinnerId); if (spinner) spinner.remove(); }
}

// --- POPUP LOGIC ---

function openJobPopup(eventObj) {
    // Clear any existing clock-in timer when opening a new popup
    if (clockInTimer) clearTimeout(clockInTimer);

    const props = eventObj.extendedProps;
    const htmlContent = generatePopupHtml(eventObj); // Pass full eventObj for time checks

    Swal.fire({
        title: props.name,
        width: 600,
        showCloseButton: true,
        showConfirmButton: false, 
        html: htmlContent,
        didOpen: () => {
            attachAddMeListener(eventObj);
            attachClockInListener(eventObj);
        },
        willClose: () => {
            // Clean up timer when popup closes
            if (clockInTimer) clearTimeout(clockInTimer);
        }
    });
}

function updatePopupContentInPlace(eventObj) {
    const htmlContent = generatePopupHtml(eventObj);
    const contentContainer = Swal.getHtmlContainer();
    if(contentContainer) {
        contentContainer.innerHTML = htmlContent;
        attachAddMeListener(eventObj); 
        attachClockInListener(eventObj);
    }
}

function generatePopupHtml(eventObj) {
    const props = eventObj.extendedProps;
    const start = eventObj.start;
    const end = eventObj.end;
    
    // --- USER CONTEXT ---
    let currentUserName = "";
    let currentUserEmail = "";
    if (window.parent && window.parent.user && window.parent.user.data) {
        currentUserName = window.parent.user.data.name || "";
        currentUserEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : "");
    }
    const parentRole = (window.parent && window.parent.userRole) ? window.parent.userRole : [];
    const isHoobastank = parentRole.includes("Hoobastank");

    // --- LOGIC: ADD ME BUTTON ---
    const needsMover = props.actualCount < props.moverCount;
    const isFuture = start > new Date();
    
    // Check if I am already on the job (Name Check for visual safety)
    let alreadyOnJobByName = false;
    if (props.team && currentUserName && props.team.includes(currentUserName)) {
        alreadyOnJobByName = true;
    }
    const showAddButton = isHoobastank && needsMover && isFuture && !alreadyOnJobByName;

    // --- LOGIC: CLOCK IN BUTTON (FIXED) ---
    // 1. Email Match (Am I on the team?)
    // We now look at the comma-separated string coming from "Movers2.Email" which we stored in props.moverEmails
    const allowedEmails = props.moverEmails || ""; 
    const onTeamByEmail = currentUserEmail && allowedEmails.toLowerCase().includes(currentUserEmail.toLowerCase());
    
    // 2. Time Check (Within 10 mins)
    const TEN_MIN_MS = 10 * 60 * 1000;
    const now = new Date().getTime();
    const startTime = start.getTime();
    const timeUntilStart = startTime - now;
    
    let showClockInButton = false;

    // If I'm on the team...
    if (onTeamByEmail) {
        if (timeUntilStart <= TEN_MIN_MS) {
            // It is less than 10 mins to start (or already started)
            showClockInButton = true;
        } else {
            // It is TOO EARLY. Start a timer to refresh UI when window opens.
            const delay = timeUntilStart - TEN_MIN_MS;
            // Only set timer if delay is reasonable (e.g., < 24 hours) to avoid memory leaks
            if (delay > 0 && delay < 86400000) {
                console.log(`Clock In available in ${Math.ceil(delay/60000)} minutes. Timer set.`);
                if (clockInTimer) clearTimeout(clockInTimer);
                clockInTimer = setTimeout(() => {
                    console.log("Timer fired! Refreshing popup to show Clock In.");
                    updatePopupContentInPlace(eventObj);
                }, delay);
            }
        }
    }

    // --- GENERATE HTML ---
    var dateStr = formatPopupDate(start);
    var startTimeStr = formatPopupTime(start);
    var endTimeStr = end ? formatPopupTime(end) : "Unknown";
    var fullTimeHeader = `${dateStr}, ${startTimeStr} - ${endTimeStr}`;
    var originLink = getMapLink(props.origin);
    var destLink = getMapLink(props.destination);

    // Button HTML
    let buttonsHtml = "";
    if (showAddButton) {
        buttonsHtml += `<button id="btn-add-me" class="btn-add-me"><span>+</span> Add Me</button>`;
    }
    if (showClockInButton) {
        buttonsHtml += `<button id="btn-clock-in" class="btn-clock-in">⏱ Clock In</button>`;
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
                <a href="${originLink}" target="_blank" class="popup-link" style="flex: 1;">${getDisplayAddr(props.origin)}</a>
            </div>
            <div style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                <strong style="min-width: 80px; color: #333; margin-right: 10px;">🏁 Dropoff:</strong>
                <a href="${destLink}" target="_blank" class="popup-link" style="flex: 1;">${getDisplayAddr(props.destination)}</a>
            </div>
            <hr style="border-top: 1px solid #eee; margin: 15px 0;">
            <strong>📋 Services Provided:</strong>
            <div class="services-box" style="margin-top: 5px;">${props.services ? String(props.services).trim() : "No details."}</div>
            <hr style="border-top: 1px solid #eee; margin: 15px 0;">
            <div style="margin-top: 5px;">
                <strong>👷 Team:</strong> ${buttonsHtml}
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

function attachClockInListener(eventObj) {
    const btn = document.getElementById('btn-clock-in');
    if (btn) {
        btn.addEventListener('click', () => {
            // 1. Show Loading State
            btn.innerHTML = `<div class="loader-spinner small" style="border-top-color:white; margin:0;"></div> Getting Location...`;
            btn.disabled = true;

            // 2. Get Geolocation
            if (!navigator.geolocation) {
                Swal.fire('Error', 'Geolocation is not supported by your browser.', 'error');
                btn.innerHTML = '⏱ Clock In'; btn.disabled = false;
                return;
            }

            navigator.geolocation.getCurrentPosition(async (position) => {
                try {
                    btn.innerHTML = `<div class="loader-spinner small" style="border-top-color:white; margin:0;"></div> Clocking In...`;

                    // 3. Get User Email from Parent
                    let userEmail = null;
                    if (window.parent && window.parent.user && window.parent.user.data) {
                        userEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : null);
                    }
                    if(!userEmail) throw new Error("User email not found.");

                    // 4. Get IP (Optional but good for accuracy)
                    let userIp = "Unknown";
                    try {
                        const ipRes = await fetch('https://api.ipify.org?format=json');
                        const ipData = await ipRes.json();
                        userIp = ipData.ip;
                    } catch(e) { console.warn("Could not fetch IP", e); }

                    // 5. Call Backend
                    const response = await fetch(NETLIFY_CLOCKIN_ENDPOINT, {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${currentAuthToken}`,
                            'Content-Type': 'application/json' 
                        },
                        body: JSON.stringify({
                            jobId: eventObj.extendedProps.id,
                            userEmail: userEmail,
                            userLat: position.coords.latitude,
                            userLon: position.coords.longitude,
                            userIp: userIp
                        })
                    });

                    const result = await response.json();

                    if (!response.ok) {
                        // HANDLE DISTANCE ERROR SPECIFICALLY
                        if (result.error === "DISTANCE_FAIL") {
                            Swal.fire({
                                icon: 'error',
                                title: 'Too Far Away',
                                text: "We can't clock you in yet, you are not close enough to the job site yet, homie.",
                                confirmButtonText: 'OK'
                            }).then(() => {
                                // Re-open the main popup (User requirement: "closed this new popup navigate the user back")
                                // Since SweetAlert replaces the current one, we just re-open logic
                                openJobPopup(eventObj);
                            });
                        } else {
                            throw new Error(result.message || result.error || "Clock-In Failed");
                        }
                    } else {
                        // SUCCESS
                        Swal.fire({
                            icon: 'success',
                            title: 'Clocked In!',
                            text: 'You have successfully clocked in.',
                            timer: 2000,
                            showConfirmButton: false
                        }).then(() => {
                            // Optionally refresh to remove the button or disable it
                            // For now, we leave it or close popup
                            btn.style.display = 'none';
                        });
                    }

                } catch (err) {
                    console.error(err);
                    Swal.fire('Error', err.message, 'error');
                    btn.innerHTML = '⏱ Clock In'; 
                    btn.disabled = false;
                }
            }, (err) => {
                console.warn(err);
                Swal.fire('Location Error', 'You must allow location access to clock in.', 'warning');
                btn.innerHTML = '⏱ Clock In'; 
                btn.disabled = false;
            }, { enableHighAccuracy: true, timeout: 10000 });
        });
    }
}

// --- STANDARD ADD ME LISTENER (Unchanged logic, just cleaner) ---
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
                <div id="confirm-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.95); z-index: 1000; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
                    <h3 style="margin: 0 0 10px 0; color: #333;">Are you sure?</h3>
                    <p style="margin-bottom: 25px; color: #555; padding: 0 20px; font-size: 1.1em;">The job is on <strong>${niceDate}</strong><br>${niceTime} - ${niceEnd}</p>
                    <div style="display: flex; gap: 10px;">
                        <button id="btn-confirm-yes" class="btn btn-success" style="background-color:#28a745; color:white; border:none; padding:10px 20px;">Yes, I'm In</button>
                        <button id="btn-confirm-no" class="btn btn-danger" style="background-color:#d33; color:white; border:none; padding:10px 20px;">Cancel</button>
                    </div>
                </div>`;
            
            const overlayDiv = document.createElement('div');
            overlayDiv.innerHTML = overlayHtml;
            popup.style.position = 'relative';
            popup.appendChild(overlayDiv);

            document.getElementById('btn-confirm-yes').addEventListener('click', async () => {
                overlayDiv.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center;"><div class="loader-spinner large"></div><h3 style="color:#0C419a; margin-top:10px;">Adding you to job...</h3></div>`;
                try {
                    let userEmail = null; let userName = "Me";
                    if (window.parent && window.parent.user && window.parent.user.data) {
                        userEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : null);
                        userName = window.parent.user.data.name || "Me";
                    }
                    if(!userEmail) throw new Error("Could not find user email.");

                    const apiResponse = await fetch(NETLIFY_ADD_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${currentAuthToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jobId: eventObj.extendedProps.id, email: userEmail })
                    });
                    if(!apiResponse.ok) { const t = await apiResponse.text(); throw new Error(t); }

                    overlayDiv.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center;"><div style="font-size: 50px; color: #28a745;">✅</div><h2 style="color: #555; margin: 0;">Added!</h2></div>`;

                    // Optimistic UI Update
                    let currentTeam = eventObj.extendedProps.team || "";
                    if (currentTeam === "None assigned") currentTeam = "";
                    const newTeam = currentTeam ? currentTeam + ", " + userName : userName;
                    const newCount = (eventObj.extendedProps.actualCount || 0) + 1;
                    const requiredCount = eventObj.extendedProps.moverCount || 0;

                    eventObj.setExtendedProp('team', newTeam);
                    eventObj.setExtendedProp('actualCount', newCount);
                    if (newCount >= requiredCount) { eventObj.setProp('backgroundColor', '#0C419a'); eventObj.setProp('borderColor', '#0C419a'); }

                    setTimeout(() => {
                        overlayDiv.remove(); 
                        updatePopupContentInPlace(eventObj);
                        setTimeout(() => refreshSingleJobData(eventObj), 2000); 
                    }, 1000);

                } catch (err) {
                    console.error(err);
                    overlayDiv.innerHTML = `<div style="padding:20px;"><h3 style="color:red;">Error</h3><p>${err.message}</p><button id="btn-error-close" class="btn btn-default" style="margin-top:10px;">Close</button></div>`;
                    document.getElementById('btn-error-close').addEventListener('click', () => Swal.close());
                }
            });
            document.getElementById('btn-confirm-no').addEventListener('click', () => { overlayDiv.remove(); });
        });
    }
}

// --- HELPERS ---
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
    let hour = 0; let minute = 0;
    if (parts.length > 1) {
        const timeRaw = parts[1]; const timeParts = timeRaw.split(':');
        hour = parseInt(timeParts[0], 10); minute = parseInt(timeParts[1], 10);
        if (parts.length > 2) { const m = parts[2].toUpperCase(); if (m === "PM" && hour < 12) hour += 12; if (m === "AM" && hour === 12) hour = 0; }
    }
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
}
function getZohoVal(field) { return (field && field.display_value) ? field.display_value : (field || ""); }
function getShortName(fullName) { if (!fullName) return "Unknown"; var parts = fullName.trim().split(/\s+/); return parts[0] + (parts.length > 1 ? " " + parts[parts.length - 1].charAt(0) + "." : ""); }
function countMovers(moversField) { if (!moversField) return 0; if (Array.isArray(moversField)) return moversField.length; return moversField.trim() === "" ? 0 : moversField.split(',').length; }
function getMoversString(moversField) { if (!moversField) return "None assigned"; if (Array.isArray(moversField)) return moversField.map(m => (m.display_value ? m.display_value : m)).join(", "); return moversField; }
function formatPopupTime(dateObj) { if (!dateObj) return ""; return dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
function formatPopupDate(dateObj) { if (!dateObj) return ""; return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function updateTodayButton(shouldEnable) { var btn = document.querySelector('.fc-resetToday-button'); if (btn) { btn.style.opacity = shouldEnable ? '1' : '0.5'; btn.disabled = !shouldEnable; btn.style.cursor = shouldEnable ? 'pointer' : 'default'; } }
function getDisplayAddr(addrObj) { if (!addrObj) return "Unknown"; if (typeof addrObj === 'string') return addrObj; let parts = []; if (addrObj.address_line_1) parts.push(addrObj.address_line_1); if (addrObj.address_line_2) parts.push(addrObj.address_line_2); if (addrObj.district_city) parts.push(addrObj.district_city); return parts.join(", "); }
function getMapLink(addrObj) { if (!addrObj) return "#"; var mapAddr = ""; if (typeof addrObj === 'string') mapAddr = addrObj; else { let parts = []; if (addrObj.address_line_1) parts.push(addrObj.address_line_1); if (addrObj.district_city) parts.push(addrObj.district_city); if (addrObj.state_province) parts.push(addrObj.state_province); if (addrObj.postal_code) parts.push(addrObj.postal_code); mapAddr = parts.join(", "); } var isApple = /Mac|iPhone|iPod|iPad/.test(navigator.userAgent); return isApple ? "http://maps.apple.com/?daddr=" + encodeURIComponent(mapAddr) + "&dirflg=d" : "https://www.google.com/maps?daddr=" + encodeURIComponent(mapAddr) + "&dirflg=t"; }

function mapRecordsToEvents(records) {
    return records.map(function(record) {
        var startRaw = record.Agreed_Start_Date_Time; var endRaw = record.Estimate_End_Date_Time;
        var startISO = parseZohoDate(startRaw); var endISO = parseZohoDate(endRaw);
        if (!endISO && startRaw && endRaw) { try { var dateOnly = startRaw.trim().split(/\s+/)[0]; var combined = dateOnly + " " + endRaw; endISO = parseZohoDate(combined); } catch(e) {} }
        if (!startISO) return null;

        var safeName = getZohoVal(record.Customer_Name) || "Unknown";
        var requiredCount = parseInt(record.Mover_Count) || 0; 
        var actualMoversCount = countMovers(record.Movers2); 
        var servicesRaw = getZohoVal(record.Services_Provided);

        var bgColor = '#0C419a'; var bdColor = '#0C419a';
        if (servicesRaw && servicesRaw.toLowerCase().includes("pending")) { bgColor = '#28a745'; bdColor = '#28a745'; } 
        else if (actualMoversCount < requiredCount) { bgColor = '#fd7e14'; bdColor = '#fd7e14'; }

        // --- FIX: Capture emails from the comma-separated string, NOT the array ---
        // Zoho sends "Movers2.Email" as a string (e.g., "john@a.com,jane@b.com")
        // We handle the case where it might be undefined
        const teamEmailsString = record["Movers2.Email"] || "";

        return {
            title: getShortName(safeName), start: startISO, end: endISO,
            backgroundColor: bgColor, borderColor: bdColor, textColor: '#ffffff',
            extendedProps: { 
                id: record.ID, name: safeName, origin: record.Origination_Address, destination: record.Destination_Address,
                services: servicesRaw, team: getMoversString(record.Movers2),
                moverEmails: teamEmailsString, // Storing the string for easy check later
                moverCount: requiredCount, actualCount: actualMoversCount 
            }
        };
    }).filter(event => event !== null);
}