/* ============================================================
   netlify/functions/clock-in.js
   (v3.7 - Fix: Targeted "Mover_Name" Field Extraction)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const HERE_API_KEY = process.env.HERE_API_KEY; 

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_JOBS = "Proposal_Contract_Report";
const REPORT_MOVERS = "All_Movers";
const REPORT_CHECKINS = "CheckIn_Report"; 
const FORM_CHECKIN = "CheckIn";

// --- CACHE ---
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: TIMEOUT ---
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

        // 1. Auth & Mover Lookup
        const accessToken = await getAccessToken();
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // Find Mover Profile
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetchWithTimeout(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();
        
        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found in Zoho with email: ${userEmail}`);
        }
        
        const moverRecord = moverData.data[0];
        const moverId = moverRecord.ID;

        // --- NEW: EXTRACT NAME FROM "Mover_Name" ---
        let moverFullName = "";

        // Case A: Mover_Name is an object (Standard for 'Name' fields)
        if (moverRecord.Mover_Name && typeof moverRecord.Mover_Name === 'object') {
             const fName = moverRecord.Mover_Name.first_name || "";
             const lName = moverRecord.Mover_Name.last_name || "";
             moverFullName = `${fName} ${lName}`.trim();
        }
        // Case B: Mover_Name is a simple string (Sometimes returned by Reports)
        else if (moverRecord.Mover_Name) {
            moverFullName = moverRecord.Mover_Name.trim();
        }
        // Case C: Fallback to "Name" field if Mover_Name is empty
        else if (moverRecord.Name) {
            moverFullName = (typeof moverRecord.Name === 'object') 
                ? `${moverRecord.Name.first_name || ""} ${moverRecord.Name.last_name || ""}`.trim()
                : moverRecord.Name.trim();
        }

        // --- ACTION 1: CHECK STATUS ---
        if (action === 'check_status') {
            
            // Query only by JobId because "Add_Mover.ID" is hidden in your report
            const criteria = `(JobId == ${jobId})`;
            const checkUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_CHECKINS}?criteria=${criteria}`;
            
            const checkRes = await fetchWithTimeout(checkUrl, { headers: authHeader });
            const checkData = await checkRes.json();
            
            let isClockedIn = false;

            if (checkData.code === 3000 && checkData.data && Array.isArray(checkData.data)) {
                
                // Loop through all check-ins for this job
                for (const record of checkData.data) {
                    
                    // 1. TRY ID MATCH (Best Reliability)
                    let recordMoverId = record.Add_Mover || record["Add_Mover.ID"];
                    if (typeof recordMoverId === 'object' && recordMoverId.ID) recordMoverId = recordMoverId.ID;

                    if (recordMoverId && moverId && String(recordMoverId) === String(moverId)) {
                        isClockedIn = true;
                        break;
                    }

                    // 2. TRY NAME MATCH (Fallback)
                    // Matches "Add_Mover.Mover_Name" from CheckIn Report vs "Mover_Name" from Mover Profile
                    const recordMoverName = record["Add_Mover.Mover_Name"] || record["Add_Mover.display_value"];
                    
                    if (recordMoverName && moverFullName && 
                        recordMoverName.toLowerCase().trim() === moverFullName.toLowerCase()) {
                        isClockedIn = true;
                        break;
                    }
                }
            }
            
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