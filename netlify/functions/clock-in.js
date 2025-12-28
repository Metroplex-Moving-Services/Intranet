/* ============================================================
   netlify/functions/clock-in.js
   (v2.2 - Adds "Check Status" Mode to prevent duplicates)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const HERE_API_KEY = process.env.HERE_API_KEY; 

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_JOBS = "Proposal_Contract_Report";
const REPORT_MOVERS = "All_Movers";
const REPORT_CHECKINS = "CheckIn_Report"; // The report to check for duplicates 
const FORM_CHECKIN = "CheckIn";

// --- GLOBAL CACHE ---
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: GET TOKEN ---
async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
        return cachedAccessToken;
    }
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(tokenUrl, { method: 'POST' });
            const data = await res.json();
            if (data.error) throw new Error(JSON.stringify(data));
            if (data.access_token) {
                cachedAccessToken = data.access_token;
                tokenExpiryTime = Date.now() + (data.expires_in * 1000);
                return data.access_token;
            }
            if (i < retries - 1) { await new Promise(r => setTimeout(r, delay)); delay *= 2; }
            else throw new Error(JSON.stringify(data));
        } catch (err) { if (i === retries - 1) throw err; }
    }
}

// --- HELPER: DATE FORMATTER (MM-dd-yy hh:mm a) ---
function formatZohoDate() {
    const dallasDateString = new Date().toLocaleString("en-US", {timeZone: "America/Chicago"});
    const date = new Date(dallasDateString);
    const m = (date.getMonth() + 1).toString().padStart(2, '0'); 
    const d = date.getDate().toString().padStart(2, '0');        
    const y = date.getFullYear().toString().slice(-2);           
    let h = date.getHours();
    const min = date.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; h = h ? h : 12; 
    return `${m}-${d}-${y} ${h.toString().padStart(2, '0')}:${min} ${ampm}`;
}

// --- HELPER: HAVERSINE ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

exports.handler = async function(event, context) {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        const payload = JSON.parse(event.body);
        const { jobId, userEmail, userLat, userLon, userIp, pin, action } = payload; // Added 'action'
        
        if (!jobId || !userEmail) throw new Error("Missing required data.");

        // 1. Authenticate & Find Mover ID (Common to both actions)
        const accessToken = await getAccessTokenWithRetry();
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();
        
        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found in Zoho with email: ${userEmail}`);
        }
        const moverId = moverData.data[0].ID;

        // ==========================================
        // NEW LOGIC: CHECK STATUS ACTION
        // ==========================================
        if (action === 'check_status') {
            // Search CheckIn_Report for a record matching this Job AND Mover
            // Criteria: (JobId == "123" && Add_Mover == 456)
            const checkUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_CHECKINS}?criteria=(JobId == "${jobId}" && Add_Mover == ${moverId})`;
            const checkRes = await fetch(checkUrl, { headers: authHeader });
            const checkData = await checkRes.json();

            // If code is 3000 and data exists, they have already clocked in.
            const hasClockedIn = (checkData.code === 3000 && checkData.data && checkData.data.length > 0);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ clockedIn: hasClockedIn })
            };
        }

        // ==========================================
        // EXISTING LOGIC: PERFORM CLOCK IN
        // ==========================================
        
        // (Geocoding & Distance Check - same as before)
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();
        if (jobData.code !== 3000) throw new Error("Could not find Job Record.");
        
        let originAddress = (typeof jobData.data.Origination_Address === 'object') ? jobData.data.Origination_Address.display_value : jobData.data.Origination_Address;
        if (!originAddress) throw new Error("Job has no Origination Address.");

        if (!HERE_API_KEY) throw new Error("Server Error: Missing HERE_API_KEY.");
        const hereUrl = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(originAddress)}&apiKey=${HERE_API_KEY}`;
        const hereRes = await fetch(hereUrl);
        const hereData = await hereRes.json();
        if (!hereData.items || hereData.items.length === 0) throw new Error("Could not find job coordinates.");

        const jobLat = hereData.items[0].position.lat;
        const jobLon = hereData.items[0].position.lng;
        const distanceMiles = calculateDistance(userLat, userLon, jobLat, jobLon);

        if (distanceMiles > 0.25) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "DISTANCE_FAIL", message: "You are not close enough.", distance: distanceMiles.toFixed(2) }) };
        }

        // Submit Check-In
        const checkInUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/form/${FORM_CHECKIN}`;
        const checkInBody = {
            "data": {
                "JobId": jobId, "Add_Mover": moverId, "Actual_Clock_in_Time1": formatZohoDate(),
                "Mover_Coordinates": `${userLat}, ${userLon}`, "Job_Coordinates": `${jobLat}, ${jobLon}`,
                "Distance": distanceMiles.toFixed(4), "CapturedIPAddress": userIp || "Unknown", "PIN": pin || "0000"
            }
        };

        const submitRes = await fetch(checkInUrl, { method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify(checkInBody) });
        const submitData = await submitRes.json();

        if (submitData.code === 3000) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Clocked in successfully!" }) };
        } else {
            console.error("Zoho Submit Error:", JSON.stringify(submitData));
            return { statusCode: 400, headers, body: JSON.stringify({ error: "ZOHO_REJECT", details: submitData }) };
        }

    } catch (error) {
        console.error("Clock-In Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};