/* ============================================================
   netlify/functions/clock-in.js
   (v2.0 - Production Ready: Adds Token Caching & Rate Limit Protection)
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

// --- GLOBAL CACHE (The Fix for Error 429) ---
// These variables survive between function runs if the server is "warm"
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: GET TOKEN (With Caching) ---
async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    // 1. Check if we have a valid cached token
    // We subtract 60 seconds to be safe (don't use a token about to expire)
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
        console.log("Using Cached Zoho Token (Skipping API Call)");
        return cachedAccessToken;
    }

    console.log("Cache empty or expired. Fetching NEW Zoho Token...");
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(tokenUrl, { method: 'POST' });
            const data = await res.json();
            
            if (data.error) {
                // If we hit the rate limit, THROW immediately so we can see it
                throw new Error(JSON.stringify(data));
            }

            if (data.access_token) {
                // 2. Save to Cache
                cachedAccessToken = data.access_token;
                // 'expires_in' is usually 3600 seconds (1 hour). Convert to milliseconds.
                tokenExpiryTime = Date.now() + (data.expires_in * 1000);
                return data.access_token;
            }
            
            // Retry logic
            if (i < retries - 1) { await new Promise(r => setTimeout(r, delay)); delay *= 2; }
            else throw new Error(JSON.stringify(data));

        } catch (err) { 
            console.error(`Token Fetch Attempt ${i+1} Failed:`, err);
            if (i === retries - 1) throw err; 
        }
    }
}

// --- HELPER: DATE FORMATTER ---
// FORMAT: MM-dd-yy hh:mm a (Zoho Standard)
function formatZohoDate() {
    const dallasDateString = new Date().toLocaleString("en-US", {timeZone: "America/Chicago"});
    const date = new Date(dallasDateString);

    const m = (date.getMonth() + 1).toString().padStart(2, '0'); 
    const d = date.getDate().toString().padStart(2, '0');        
    const y = date.getFullYear().toString().slice(-2);           
    
    let h = date.getHours();
    const min = date.getMinutes().toString().padStart(2, '0');
    
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12; 
    const hStr = h.toString().padStart(2, '0');

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

    try {
        const payload = JSON.parse(event.body);
        const { jobId, userEmail, userLat, userLon, userIp, pin } = payload;
        const finalPin = pin || "0000";

        if (!jobId || !userEmail || !userLat || !userLon) {
            throw new Error("Missing required data.");
        }

        // 1. Get Zoho Token (Now uses Cache!)
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
        
        const checkInBody = {
            "data": {
                "JobId": jobId,                    
                "Add_Mover": moverId,              
                "Actual_Clock_in_Time1": formatZohoDate(),
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
        // DETECT RATE LIMITS IN ERROR LOGS
        console.error("Clock-In Error:", error);
        
        const errorString = error.message || JSON.stringify(error);
        if (errorString.includes("too many requests") || errorString.includes("429")) {
             return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ error: "Zoho is busy. Please try again in 1 minute." })
            };
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || "Internal Server Error" })
        };
    }
};