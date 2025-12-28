/* ============================================================
   netlify/functions/add-mover-to-job.js
   (v2.0 - Production Ready: Adds Token Caching)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";         
const REPORT_JOBS = "Proposal_Contract_Report"; 

// --- GLOBAL CACHE (Prevents Error 429) ---
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: GET TOKEN (With Caching) ---
async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    // 1. Check Cache
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
        console.log("Using Cached Zoho Token (Skipping API Call)");
        return cachedAccessToken;
    }

    console.log("Fetching NEW Zoho Token...");
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
        } catch (err) { 
            console.error(`Token Fetch Attempt ${i+1} Failed:`, err);
            if (i === retries - 1) throw err; 
        }
    }
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
        const { jobId, email } = payload;

        if (!jobId || !email) throw new Error("Missing jobId or email");

        // 1. Get Zoho Access Token (Now Cached)
        const accessToken = await getAccessTokenWithRetry();
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // 2. Find Mover ID
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${email}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found in Zoho with email: ${email}`);
        }
        const moverId = moverData.data[0].ID;

        // 3. Get Job Details
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}?criteria=(ID == ${jobId})`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000 || !jobData.data || jobData.data.length === 0) {
            throw new Error("Could not find Job Record");
        }

        const currentRecord = jobData.data[0];
        
        // A. Normalize Movers List
        let existingMovers = [];
        if (Array.isArray(currentRecord.Movers2)) {
            existingMovers = currentRecord.Movers2.map(m => (typeof m === 'object' ? m.ID : m));
        } else if (typeof currentRecord.Movers2 === 'string' && currentRecord.Movers2.trim() !== "") {
             existingMovers = currentRecord.Movers2.split(',');
        }

        // B. Check Duplicate
        if (existingMovers.includes(moverId)) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, message: "You are already assigned to this job." })
            };
        }

        // C. Check Capacity
        const targetCount = parseInt(currentRecord.Mover_Count) || 0;
        const currentCount = existingMovers.length;

        if (currentCount >= targetCount) {
            return {
                statusCode: 409, 
                headers,
                body: JSON.stringify({ error: "This job is already full." })
            };
        }

        // 4. Update Job
        existingMovers.push(moverId);

        const updateUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const updateBody = { "data": { "Movers2": existingMovers } };

        const updateRes = await fetch(updateUrl, {
            method: 'PATCH',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(updateBody)
        });
        
        const updateData = await updateRes.json();

        if (updateData.code === 3000) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, message: "Added to job" })
            };
        } else {
            console.error("Update Response:", updateData);
            throw new Error(`Zoho Update Failed: ${JSON.stringify(updateData)}`);
        }

    } catch (error) {
        console.error("Handler Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};