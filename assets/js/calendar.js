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
            if(btn) btn.style.display = "inline-block"; // Show button if it exists
        }
    }, 60000); 
    // ------------------------------------------

    // 2. Check Auth Token
    const sessionToken = sdk.getSessionToken();

    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        // Not logged in? Redirect parent window to login
        window.top.location.href = "/Intranet/login.html";
    } else {
        // Logged in? Start the Calendar
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
            throw new Error(`Server Error: ${response.status} ${response.statusText} \nResponse: ${text.substring(0, 100)}...`);
        }
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            console.error("Received HTML instead of JSON:", text); 
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
                    moverCount: requiredCount
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
                
                // Helper internal to the popup logic
                function getDisplayAddr(addrObj) {
                    if (!addrObj) return "Unknown";
                    if (typeof addrObj === 'string') return addrObj;
                    let parts = [];
                    if (addrObj.address_line_1) parts.push(addrObj.address_line_1);
                    if (addrObj.address_line_2) parts.push(addrObj.address_line_2);
                    if (addrObj.
