/* ============================================================
   assets/js/calendar.js
   (v3.1 - Fixed: Restored Confirmation Text & Instant UI Updates)
   ============================================================ */

const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });
const NETLIFY_GET_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/get-calendar";
const NETLIFY_ADD_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/add-mover-to-job";
const NETLIFY_CLOCKIN_ENDPOINT = "https://metroplexmovingservices.netlify.app/.netlify/functions/clock-in";

// --- STYLES ---
const style = document.createElement('style');
style.innerHTML = `
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .loader-spinner { border: 3px solid #f3f3f3; border-top: 3px solid #0C419a; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px; }
    .loader-spinner.small { width: 14px; height: 14px; border-width: 2px; }
    .loader-spinner.large { width: 40px; height: 40px; border-width: 5px; border-top-color: #28a745; margin-bottom: 10px; }
    .btn-add-me { background: linear-gradient(135deg, #28a745 0%, #218838 100%); color: white; border: none; border-radius: 50px; padding: 6px 16px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; cursor: pointer; margin-left: 10px; }
    .btn-clock-in { background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; border: none; border-radius: 50px; padding: 6px 16px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; cursor: pointer; margin-left: 10px; display: inline-flex; align-items: center; gap: 5px; }
    .btn-clock-in:disabled { background: #ccc; cursor: not-allowed; transform: none; box-shadow: none; }
`;
document.head.appendChild(style);

let clockInTimer = null;
let calendarInstance = null;
let currentAuthToken = null;

document.addEventListener('DOMContentLoaded', async function() {
    const sessionToken = sdk.getSessionToken();
    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        window.top.location.href = "/Intranet/login.html";
    } else {
        initCalendar(sessionToken);
    }
});

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
    });
}

function fetchCalendarData(token, specificJobId = null) {
    let url = NETLIFY_GET_ENDPOINT;
    const timestamp = new Date().getTime(); 
    if (specificJobId) url += `?id=${specificJobId}&_t=${timestamp}`; 
    else url += `?_t=${timestamp}`;

    return fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(async response => {
        if (!response.ok) { const text = await response.text(); throw new Error(`Server Error: ${response.status}`); }
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
            calendarEvent.setExtendedProp('moverEmails', dummyEvent.extendedProps.moverEmails);
            
            const openPopupId = document.getElementById(`popup-job-id-${jobId}`);
            if (openPopupId) { updatePopupContentInPlace(calendarEvent); }
        }
    } catch (err) { console.error("Refresh failed", err); } 
    finally { const spinner = document.getElementById(spinnerId); if (spinner) spinner.remove(); }
}

// --- POPUP LOGIC ---

async function checkClockInStatus(jobId, userEmail) {
    try {
        const response = await fetch(NETLIFY_CLOCKIN_ENDPOINT, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentAuthToken}` },
            body: JSON.stringify({ action: 'check_status', jobId: jobId, userEmail: userEmail })
        });
        const data = await response.json();
        return data.clockedIn === true;
    } catch (e) { return false; }
}

async function resolveClockInState(eventObj) {
    const wrapper = document.getElementById('clock-in-wrapper');
    if (!wrapper) return;

    let userEmail = null;
    if (window.parent && window.parent.user && window.parent.user.data) {
        userEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : null);
    }

    if (userEmail) {
        const alreadyClockedIn = await checkClockInStatus(eventObj.extendedProps.id, userEmail);
        if (alreadyClockedIn) {
            wrapper.innerHTML = `<span style="color:#28a745; font-weight:bold; margin-left:5px;">✅ Clocked In</span>`;
        } else {
            wrapper.innerHTML = `<button id="btn-clock-in" class="btn-clock-in">⏱ Clock In</button>`;
            attachClockInListener(eventObj);
        }
    } else {
        wrapper.style.display = 'none';
    }
}

function openJobPopup(eventObj) {
    if (clockInTimer) clearTimeout(clockInTimer);
    const htmlContent = generatePopupHtml(eventObj);
    Swal.fire({
        title: eventObj.extendedProps.name,
        width: 600,
        showCloseButton: true,
        showConfirmButton: false, 
        html: htmlContent,
        didOpen: () => {
            attachAddMeListener(eventObj);
            resolveClockInState(eventObj);
        },
        willClose: () => { if (clockInTimer) clearTimeout(clockInTimer); }
    });
}

function updatePopupContentInPlace(eventObj) {
    const htmlContent = generatePopupHtml(eventObj);
    const contentContainer = Swal.getHtmlContainer();
    if(contentContainer) {
        contentContainer.innerHTML = htmlContent;
        attachAddMeListener(eventObj); 
        resolveClockInState(eventObj);
    }
}

function generatePopupHtml(eventObj) {
    const props = eventObj.extendedProps;
    const start = eventObj.start;
    const end = eventObj.end;
    
    // User Context
    let currentUserName = ""; let currentUserEmail = "";
    if (window.parent && window.parent.user && window.parent.user.data) {
        currentUserName = window.parent.user.data.name || "";
        currentUserEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : "");
    }
    const parentRole = (window.parent && window.parent.userRole) ? window.parent.userRole : [];
    const isHoobastank = parentRole.includes("Hoobastank");

    // Add Me Logic
    const needsMover = props.actualCount < props.moverCount;
    const isFuture = start > new Date();
    let alreadyOnJobByName = props.team && currentUserName && props.team.includes(currentUserName);
    const showAddButton = isHoobastank && needsMover && isFuture && !alreadyOnJobByName;

    // Clock In Logic
    const allowedEmails = props.moverEmails || ""; 
    const onTeamByEmail = currentUserEmail && allowedEmails.toLowerCase().includes(currentUserEmail.toLowerCase());
    
    const TEN_MIN_MS = 10 * 60 * 1000;
    const timeUntilStart = start.getTime() - new Date().getTime();
    
    let canShowClockIn = false;
    if (onTeamByEmail) {
        if (timeUntilStart <= TEN_MIN_MS) {
            canShowClockIn = true;
        } else {
            if (timeUntilStart < 86400000) {
                if (clockInTimer) clearTimeout(clockInTimer);
                clockInTimer = setTimeout(() => updatePopupContentInPlace(eventObj), timeUntilStart - TEN_MIN_MS);
            }
        }
    }

    var dateStr = formatPopupDate(start);
    var startTimeStr = formatPopupTime(start);
    var endTimeStr = end ? formatPopupTime(end) : "Unknown";
    var originLink = getMapLink(props.origin);
    var destLink = getMapLink(props.destination);

    let buttonsHtml = "";
    if (showAddButton) buttonsHtml += `<button id="btn-add-me" class="btn-add-me"><span>+</span> Add Me</button>`;
    
    if (canShowClockIn) {
        buttonsHtml += `<span id="clock-in-wrapper" style="margin-left:10px;"><div class="loader-spinner small" style="border-top-color:#007bff; vertical-align:middle;"></div></span>`;
    }

    return `
        <div id="popup-content-container" style="text-align: left; font-size: 1.1em;">
            <div style="margin-bottom: 20px; font-weight: bold; font-size: 1.2em; color: #444; border-bottom: 2px solid #0C419a; padding-bottom: 10px;">
                📅 ${dateStr}, ${startTimeStr} - ${endTimeStr}
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
        </div>
    `;
}

// --- FIXED ADD ME LISTENER (Restored Message + Instant UI Update) ---
function attachAddMeListener(eventObj) {
    const btn = document.getElementById('btn-add-me');
    if (btn) {
        btn.addEventListener('click', () => {
            // 1. Restore the Nice Date Message
            const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
            const niceDate = eventObj.start.toLocaleDateString('en-US', dateOptions);
            const niceTime = formatPopupTime(eventObj.start);
            const niceEnd  = eventObj.end ? formatPopupTime(eventObj.end) : "?";

            const popup = Swal.getPopup();
            const overlayDiv = document.createElement('div');
            // Restored the text: "The job is on..."
            overlayDiv.innerHTML = `
                <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.95); z-index: 1000; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
                    <h3 style="margin: 0 0 10px 0; color: #333;">Are you sure?</h3>
                    <p style="margin-bottom: 25px; color: #555; padding: 0 20px; font-size: 1.1em;">The job is on <strong>${niceDate}</strong><br>${niceTime} - ${niceEnd}</p>
                    <div style="display: flex; gap: 10px;">
                        <button id="btn-confirm-yes" style="background-color:#28a745; color:white; border:none; padding:10px 20px; cursor:pointer;">Yes, I'm In</button>
                        <button id="btn-confirm-no" style="background-color:#d33; color:white; border:none; padding:10px 20px; cursor:pointer;">Cancel</button>
                    </div>
                </div>`;
            popup.appendChild(overlayDiv);

            document.getElementById('btn-confirm-yes').addEventListener('click', async () => {
                overlayDiv.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center;"><div class="loader-spinner large"></div><h3 style="color:#0C419a; margin-top:10px;">Adding you to job...</h3></div>`;
                try {
                    let userEmail = null; let userName = "Me";
                    if (window.parent && window.parent.user && window.parent.user.data) {
                        userEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : null);
                        userName = window.parent.user.data.name || "Me";
                    }
                    if(!userEmail) throw new Error("Email not found.");

                    const apiResponse = await fetch(NETLIFY_ADD_ENDPOINT, {
                        method: 'POST', headers: { 'Authorization': `Bearer ${currentAuthToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jobId: eventObj.extendedProps.id, email: userEmail })
                    });
                    if(!apiResponse.ok) throw new Error(await apiResponse.text());

                    overlayDiv.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center;"><div style="font-size: 50px; color: #28a745;">✅</div><h2 style="color: #555; margin: 0;">Added!</h2></div>`;

                    // 2. Optimistic UI Update (Shows Name Instantly)
                    let currentTeam = eventObj.extendedProps.team || "";
                    if (currentTeam === "None assigned") currentTeam = "";
                    const newTeam = currentTeam ? currentTeam + ", " + userName : userName;
                    const newCount = (eventObj.extendedProps.actualCount || 0) + 1;
                    const requiredCount = eventObj.extendedProps.moverCount || 0;

                    // Update the Event Object in memory
                    eventObj.setExtendedProp('team', newTeam);
                    eventObj.setExtendedProp('actualCount', newCount);
                    if (newCount >= requiredCount) { 
                        eventObj.setProp('backgroundColor', '#0C419a'); 
                        eventObj.setProp('borderColor', '#0C419a'); 
                    }

                    setTimeout(() => { 
                        overlayDiv.remove(); 
                        // Re-render the popup with the new data immediately
                        updatePopupContentInPlace(eventObj); 
                        // Then fetch from server to confirm
                        refreshSingleJobData(eventObj); 
                    }, 1000);

                } catch (err) {
                    overlayDiv.innerHTML = `<div style="padding:20px;"><h3 style="color:red;">Error</h3><p>${err.message}</p><button id="btn-err-close" style="padding:5px 10px;">Close</button></div>`;
                    document.getElementById('btn-err-close').onclick = () => Swal.close();
                }
            });
            document.getElementById('btn-confirm-no').onclick = () => overlayDiv.remove();
        });
    }
}

function attachClockInListener(eventObj) {
    const btn = document.getElementById('btn-clock-in');
    if (btn) {
        btn.addEventListener('click', () => {
            btn.innerHTML = `<div class="loader-spinner small" style="border-top-color:white; margin:0;"></div> Getting Location...`;
            btn.disabled = true;

            if (!navigator.geolocation) {
                Swal.fire('Error', 'Geolocation is not supported.', 'error');
                btn.innerHTML = '⏱ Clock In'; btn.disabled = false;
                return;
            }

            navigator.geolocation.getCurrentPosition(async (position) => {
                try {
                    btn.innerHTML = `<div class="loader-spinner small" style="border-top-color:white; margin:0;"></div> Clocking In...`;

                    let userEmail = null;
                    if (window.parent && window.parent.user && window.parent.user.data) {
                        userEmail = window.parent.user.data.email || (window.parent.user.data.loginIds ? window.parent.user.data.loginIds[0] : null);
                    }
                    if(!userEmail) throw new Error("User email not found.");

                    let userIp = "Unknown";
                    try { const ipRes = await fetch('https://api.ipify.org?format=json'); const ipData = await ipRes.json(); userIp = ipData.ip; } catch(e) {}

                    const response = await fetch(NETLIFY_CLOCKIN_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${currentAuthToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'clock_in', // Normal clock in
                            jobId: eventObj.extendedProps.id,
                            userEmail: userEmail,
                            userLat: position.coords.latitude,
                            userLon: position.coords.longitude,
                            userIp: userIp,
                            pin: '0000'
                        })
                    });

                    const result = await response.json();

                    if (!response.ok) {
                        if (result.error === "DISTANCE_FAIL") {
                            Swal.fire({ icon: 'error', title: 'Too Far', text: "You are not close enough to the job site.", confirmButtonText: 'OK' })
                            .then(() => openJobPopup(eventObj));
                        } else {
                            throw new Error(result.message || "Clock-In Failed");
                        }
                    } else {
                        Swal.fire({ icon: 'success', title: 'Clocked In!', timer: 2000, showConfirmButton: false })
                        .then(() => {
                            const wrapper = document.getElementById('clock-in-wrapper');
                            if(wrapper) wrapper.innerHTML = `<span style="color:#28a745; font-weight:bold; margin-left:5px;">✅ Clocked In</span>`;
                        });
                    }
                } catch (err) {
                    Swal.fire('Error', err.message, 'error');
                    btn.innerHTML = '⏱ Clock In'; btn.disabled = false;
                }
            }, (err) => {
                Swal.fire('Location Error', 'Allow location access.', 'warning');
                btn.innerHTML = '⏱ Clock In'; btn.disabled = false;
            }, { enableHighAccuracy: true, timeout: 10000 });
        });
    }
}

// --- HELPERS (Same as before) ---
function parseZohoDate(dateStr) {
    if (!dateStr) return null;
    dateStr = dateStr.trim();
    const parts = dateStr.split(/\s+/); 
    const dateRaw = parts[0].replace(/\//g, '-');
    const dateParts = dateRaw.split('-'); 
    if (dateParts.length < 3) return null;
    let year = parseInt(dateParts[2], 10); if (year < 100) year += 2000;
    let hour = 0; let minute = 0;
    if (parts.length > 1) {
        const timeParts = parts[1].split(':'); hour = parseInt(timeParts[0], 10); minute = parseInt(timeParts[1], 10);
        if (parts.length > 2) { const m = parts[2].toUpperCase(); if (m === "PM" && hour < 12) hour += 12; if (m === "AM" && hour === 12) hour = 0; }
    }
    return `${year}-${dateParts[0].padStart(2,'0')}-${dateParts[1].padStart(2,'0')}T${hour.toString().padStart(2,'0')}:${minute.toString().padStart(2,'0')}:00`;
}
function getZohoVal(f) { return (f && f.display_value) ? f.display_value : (f || ""); }
function getShortName(n) { if (!n) return "Unknown"; var p = n.trim().split(/\s+/); return p[0] + (p.length > 1 ? " " + p[p.length - 1].charAt(0) + "." : ""); }
function countMovers(m) { if (!m) return 0; if (Array.isArray(m)) return m.length; return m.trim() === "" ? 0 : m.split(',').length; }
function getMoversString(m) { if (!m) return "None assigned"; if (Array.isArray(m)) return m.map(x => (x.display_value ? x.display_value : x)).join(", "); return m; }
function formatPopupTime(d) { if (!d) return ""; return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
function formatPopupDate(d) { if (!d) return ""; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function updateTodayButton(e) { var b = document.querySelector('.fc-resetToday-button'); if (b) { b.style.opacity = e ? '1' : '0.5'; b.disabled = !e; } }
function getDisplayAddr(a) { if (!a) return "Unknown"; if (typeof a === 'string') return a; let p = []; if (a.address_line_1) p.push(a.address_line_1); if (a.district_city) p.push(a.district_city); return p.join(", "); }
function getMapLink(a) { if (!a) return "#"; var m = (typeof a === 'string') ? a : [a.address_line_1, a.district_city, a.state_province, a.postal_code].join(", "); var isApple = /Mac|iPhone|iPod|iPad/.test(navigator.userAgent); return isApple ? "http://maps.apple.com/?daddr=" + encodeURIComponent(m) + "&dirflg=d" : "https://www.google.com/maps?daddr=" + encodeURIComponent(m) + "&dirflg=t"; }

function mapRecordsToEvents(records) {
    return records.map(function(record) {
        var startRaw = record.Agreed_Start_Date_Time; var endRaw = record.Estimate_End_Date_Time;
        var startISO = parseZohoDate(startRaw); var endISO = parseZohoDate(endRaw);
        if (!endISO && startRaw && endRaw) { try { var dateOnly = startRaw.trim().split(/\s+/)[0]; endISO = parseZohoDate(dateOnly + " " + endRaw); } catch(e) {} }
        if (!startISO) return null;

        var safeName = getZohoVal(record.Customer_Name) || "Unknown";
        var requiredCount = parseInt(record.Mover_Count) || 0; 
        var actualMoversCount = countMovers(record.Movers2); 
        var servicesRaw = getZohoVal(record.Services_Provided);

        var bgColor = '#0C419a'; var bdColor = '#0C419a';
        if (servicesRaw && servicesRaw.toLowerCase().includes("pending")) { bgColor = '#28a745'; bdColor = '#28a745'; } 
        else if (actualMoversCount < requiredCount) { bgColor = '#fd7e14'; bdColor = '#fd7e14'; }

        return {
            title: getShortName(safeName), start: startISO, end: endISO,
            backgroundColor: bgColor, borderColor: bdColor, textColor: '#ffffff',
            extendedProps: { 
                id: record.ID, name: safeName, origin: record.Origination_Address, destination: record.Destination_Address,
                services: servicesRaw, team: getMoversString(record.Movers2),
                moverEmails: record["Movers2.Email"] || "",
                moverCount: requiredCount, actualCount: actualMoversCount 
            }
        };
    }).filter(event => event !== null);
}