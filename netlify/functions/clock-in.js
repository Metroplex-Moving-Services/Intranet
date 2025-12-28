/* ============================================================
   netlify/functions/clock-in.js
   Handles Geocoding, Distance Calculation, and Zoho Check-In
   (v1.2 - Fixed Address Object Bug)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const HERE_API_KEY = process.env.HERE_API_KEY; 

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_JOBS = "Proposal_Contract_Report";
const REPORT_MOVERS = "All_Movers";
const FORM_CHECKIN = "CheckIn";

// --- HELPER: RETRY LOGIC (Shared) ---
async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(tokenUrl, { method: 'POST' });
            const data = await res.json();
            if (data.access_token) return data.access_token;
            if (i < retries - 1) { await new Promise(r => setTimeout(r, delay)); delay *= 2; }
            else throw new Error(JSON.stringify(data));
        } catch (err) { if (i === retries - 1) throw err; }
    }
}

// --- HELPER: DATE FORMATTER (dd-MMM-yyyy HH:mm:ss) ---
function formatZohoDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = date.getDate().toString().padStart(2, '0');
    const m = months[date.getMonth()];
    const y = date.getFullYear();
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${d}-${m}-${y} ${h}:${min}:${s}`;
}

// --- HELPER: HAVERSINE DISTANCE (Miles) ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth radius in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
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
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

    try {
        const payload = JSON.parse(event.body);
        const { jobId, userEmail, userLat, userLon, userIp } = payload;

        if (!jobId || !userEmail || !userLat || !userLon) {
            throw new Error("Missing required data (jobId, email, or coordinates).");
        }

        // 1. Get Zoho Token
        const accessToken = await getAccessTokenWithRetry();
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // 2. Fetch Job Details (to get Address)
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000) throw new Error("Could not find Job Record.");
        const jobRecord = jobData.data;
        
        // --- FIX: Handle Zoho Address Object ---
        let originRaw = jobRecord.Origination_Address;
        let originAddress = "";

        if (typeof originRaw === 'object' && originRaw !== null) {
            // Zoho sends address as an object with { display_value: "123 Main St..." }
            originAddress = originRaw.display_value || "";
        } else {
            // Sometimes it's just a string
            originAddress = String(originRaw || "").trim();
        }

        if (!originAddress) throw new Error("Job has no Origination Address.");

        console.log(`Geocoding Address: ${originAddress}`); // Debugging log

        // 3. Geocode Job Address (HERE.com API)
        if (!HERE_API_KEY) throw new Error("Server Error: Missing HERE_API_KEY.");
        
        const hereUrl = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(originAddress)}&apiKey=${HERE_API_KEY}`;
        const hereRes = await fetch(hereUrl);
        const hereData = await hereRes.json();

        if (!hereData.items || hereData.items.length === 0) {
            console.error("HERE API Response:", JSON.stringify(hereData));
            throw new Error(`Could not find coordinates for: ${originAddress}`);
        }

        const jobLat = hereData.items[0].position.lat;
        const jobLon = hereData.items[0].position.lng;

        // 4. Calculate Distance
        const distanceMiles = calculateDistance(userLat, userLon, jobLat, jobLon);
        console.log(`Clock-In Distance Check: ${distanceMiles.toFixed(4)} miles`);

        // --- DISTANCE CHECK (Quarter Mile) ---
        if (distanceMiles > 0.25) {
            return {
                statusCode: 400, // Bad Request
                headers,
                body: JSON.stringify({ 
                    error: "DISTANCE_FAIL", 
                    message: "You are not close enough to the job site, homie.",
                    distance: distanceMiles.toFixed(2)
                })
            };
        }

        // 5. Find Mover ID (Zoho)
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found with email: ${userEmail}`);
        }
        const moverId = moverData.data[0].ID;

        // 6. Submit Check-In to Zoho
        const checkInUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/form/${FORM_CHECKIN}`;
        
        const checkInBody = {
            "data": {
                "JobId": jobId,                    // Lookup ID
                "Add_Mover": moverId,              // Lookup ID
                "Actual_Clock_in_Time1": formatZohoDate(new Date()),
                "Mover_Coordinates": `${userLat}, ${userLon}`,
                "Job_Coordinates": `${jobLat}, ${jobLon}`,
                "Distance": distanceMiles.toFixed(4),
                "CapturedIPAddress": userIp || "Unknown",
                "PIN": "0000"
            }
        };

        const submitRes = await fetch(checkInUrl, {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(checkInBody)
        });

        const submitData = await submitRes.json();

        if (submitData.code === 3000) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, message: "Clocked in homie!" })
            };
        } else {
            console.error("Zoho Submit Error:", submitData);
            throw new Error("Failed to create Check-In record in Zoho.");
        }

    } catch (error) {
        console.error("Clock-In Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || "Internal Server Error" })
        };
    }
};