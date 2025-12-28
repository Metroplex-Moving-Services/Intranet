/* ============================================================
   netlify/functions/clock-in.js
   Handles Geocoding, Distance Calculation, and Zoho Check-In
   (v1.9 - User Suggested Format: MM-dd-yy hh:mm a)
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

// --- HELPER: RETRY LOGIC ---
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

// --- HELPER: DATE FORMATTER ---
// FORMAT: MM-dd-yy hh:mm a (e.g. 12-28-25 05:22 PM)
// TIMEZONE: Converts UTC to Dallas/Central Time
function formatZohoDate() {
    // 1. Get current time in Dallas/Central Time
    const dallasDateString = new Date().toLocaleString("en-US", {timeZone: "America/Chicago"});
    const date = new Date(dallasDateString);

    const m = (date.getMonth() + 1).toString().padStart(2, '0'); // Month
    const d = date.getDate().toString().padStart(2, '0');        // Day
    const y = date.getFullYear().toString().slice(-2);           // 2-Digit Year (25)
    
    let h = date.getHours();
    const min = date.getMinutes().toString().padStart(2, '0');
    
    // AM/PM Conversion
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12; // '0' becomes '12'
    const hStr = h.toString().padStart(2, '0');

    // Result: "12-28-25 05:22 PM"
    return `${m}-${d}-${y} ${hStr}:${min} ${ampm}`;
}

// --- HELPER: HAVERSINE DISTANCE ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
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
        const { jobId, userEmail, userLat, userLon, userIp, pin } = payload;
        const finalPin = pin || "0000";

        if (!jobId || !userEmail || !userLat || !userLon) {
            throw new Error("Missing required data (jobId, email, or coordinates).");
        }

        // 1. Get Zoho Token
        const accessToken = await getAccessTokenWithRetry();
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // 2. Fetch Job Details
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000) throw new Error("Could not find Job Record.");
        
        let originRaw = jobData.data.Origination_Address;
        let originAddress = (typeof originRaw === 'object' && originRaw !== null) ? (originRaw.display_value || "") : String(originRaw || "").trim();

        if (!originAddress) throw new Error("Job has no Origination Address.");

        // 3. Geocode Job Address
        if (!HERE_API_KEY) throw new Error("Server Error: Missing HERE_API_KEY.");
        const hereUrl = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(originAddress)}&apiKey=${HERE_API_KEY}`;
        const hereRes = await fetch(hereUrl);
        const hereData = await hereRes.json();

        if (!hereData.items || hereData.items.length === 0) {
            throw new Error(`Could not find coordinates for: ${originAddress}`);
        }

        const jobLat = hereData.items[0].position.lat;
        const jobLon = hereData.items[0].position.lng;

        // 4. Calculate Distance
        const distanceMiles = calculateDistance(userLat, userLon, jobLat, jobLon);
        if (distanceMiles > 0.25) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: "DISTANCE_FAIL", 
                    message: "You are not close enough to the job site.",
                    distance: distanceMiles.toFixed(2)
                })
            };
        }

        // 5. Find Mover ID
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found in Zoho with email: ${userEmail}`);
        }
        const moverId = moverData.data[0].ID;

        // 6. Submit Check-In
        const checkInUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/form/${FORM_CHECKIN}`;
        
        const clockInTime = formatZohoDate(); 
        console.log("Submitting Time:", clockInTime);

        const checkInBody = {
            "data": {
                "JobId": jobId,                    
                "Add_Mover": moverId,              
                "Actual_Clock_in_Time1": clockInTime, // Using MM-dd-yy hh:mm a
                "Mover_Coordinates": `${userLat}, ${userLon}`,
                "Job_Coordinates": `${jobLat}, ${jobLon}`,
                "Distance": distanceMiles.toFixed(4),
                "CapturedIPAddress": userIp || "Unknown",
                "PIN": finalPin
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
                body: JSON.stringify({ success: true, message: "Clocked in successfully!" })
            };
        } else {
            console.error("Zoho Submit Error:", JSON.stringify(submitData));
            return {
                statusCode: 400, 
                headers,
                body: JSON.stringify({ error: "ZOHO_REJECT", details: submitData }) 
            };
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