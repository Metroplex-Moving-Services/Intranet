/* ============================================================
   netlify/functions/clock-in.js
   (v3.2 - Fix: "JobId" is a Number type - Removed Quotes)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const HERE_API_KEY = process.env.HERE_API_KEY; 

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_JOBS = "Proposal_Contract_Report";
const REPORT_MOVERS = "All_Movers";

// IMPORTANT: Ensure "CheckIn_Report" shows ALL records in Zoho Creator.
// If this report has a filter for "Today", the API will fail for yesterday's jobs.
const REPORT_CHECKINS = "CheckIn_Report"; 
const FORM_CHECKIN = "CheckIn";

// --- CACHE (Saves Money) ---
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: TIMEOUT (Saves Runtime) ---
async function fetchWithTimeout(url, options = {}, timeout = 6000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } catch (error) {
        throw new Error(error.name === 'AbortError' ? 'Timeout: Zoho took too long.' : error.message);
    } finally {
        clearTimeout(id);
    }
}

// --- HELPER: GET TOKEN ---
async function getAccessToken() {
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) return cachedAccessToken;
    
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    const res = await fetchWithTimeout(tokenUrl, { method: 'POST' });
    const data = await res.json();
    
    if (data.access_token) {
        cachedAccessToken = data.access_token;
        tokenExpiryTime = Date.now() + (data.expires_in * 1000);
        return data.access_token;
    }
    throw new Error("Auth Failed: " + JSON.stringify(data));
}

// --- HELPER: FORMATS ---
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

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        const payload = JSON.parse(event.body);
        const { jobId, userEmail, userLat, userLon, userIp, pin, action } = payload;
        
        if (!jobId || !userEmail) throw new Error("Missing required data.");

        // 1. Auth & Mover Lookup (Shared)
        const accessToken = await getAccessToken();
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // Find Mover ID based on Email
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetchWithTimeout(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();
        
        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found in Zoho with email: ${userEmail}`);
        }
        const moverId = moverData.data[0].ID;

        // --- ACTION 1: CHECK STATUS ---
        if (action === 'check_status') {
            // FIXED: Your form defines JobId as a NUMBER. 
            // We removed the quotes around ${jobId} so Zoho treats it as a number comparison.
            const criteria = `(JobId == ${jobId} && Add_Mover == ${moverId})`;
            
            const checkUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_CHECKINS}?criteria=${criteria}`;
            
             console.log(`Debug Check: ${checkUrl}`); // Uncomment to debug in Netlify Logs

            const checkRes = await fetchWithTimeout(checkUrl, { headers: authHeader });
            const checkData = await checkRes.json();
            
            // If we find any records, they are clocked in
            const isClockedIn = (checkData.code === 3000 && checkData.data && checkData.data.length > 0);
            
            return { statusCode: 200, headers, body: JSON.stringify({ clockedIn: isClockedIn }) };
        }

        // --- ACTION 2: CLOCK IN ---
        
        // A. Get Job Address
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const jobRes = await fetchWithTimeout(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();
        if (jobData.code !== 3000) throw new Error("Job not found.");
        
        let originAddress = (typeof jobData.data.Origination_Address === 'object') ? jobData.data.Origination_Address.display_value : jobData.data.Origination_Address;

        // B. Geocode (HERE API)
        const hereUrl = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(originAddress)}&apiKey=${HERE_API_KEY}`;
        const hereRes = await fetchWithTimeout(hereUrl);
        const hereData = await hereRes.json();
        if (!hereData.items || hereData.items.length === 0) throw new Error("Address not found.");

        const jobLat = hereData.items[0].position.lat;
        const jobLon = hereData.items[0].position.lng;
        const distanceMiles = calculateDistance(userLat, userLon, jobLat, jobLon);

        // C. Distance Check
        if (distanceMiles > 0.25) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "DISTANCE_FAIL", message: "Too far away.", distance: distanceMiles.toFixed(2) }) };
        }

        // D. Submit
        const checkInUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/form/${FORM_CHECKIN}`;
        
        // NOTE: JobId is a Number in Zoho, but JSON handles numbers natively.
        // If Zoho complains, we can parse it: parseInt(jobId).
        const checkInBody = {
            "data": {
                "JobId": jobId, 
                "Add_Mover": moverId, 
                "Actual_Clock_in_Time1": formatZohoDate(),
                "Mover_Coordinates": `${userLat}, ${userLon}`, 
                "Job_Coordinates": `${jobLat}, ${jobLon}`,
                "Distance": distanceMiles.toFixed(4), 
                "CapturedIPAddress": userIp || "Unknown", 
                "PIN": pin || "0000"
            }
        };

        const submitRes = await fetchWithTimeout(checkInUrl, { 
            method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify(checkInBody) 
        });
        const submitData = await submitRes.json();

        if (submitData.code === 3000) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        } else {
            console.error("Zoho Reject:", submitData);
            return { statusCode: 400, headers, body: JSON.stringify({ error: "ZOHO_REJECT", details: submitData }) };
        }

    } catch (error) {
        console.error("Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};