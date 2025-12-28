// --- ZOHO CONFIGURATION ---
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";         
const REPORT_JOBS = "Proposal_Contract_Report"; 

// --- HELPER: RETRY LOGIC ---
// Tries to get a token up to 3 times if Zoho says "Access Denied" (Rate Limit)
async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(tokenUrl, { method: 'POST' });
            const data = await res.json();
            
            if (data.access_token) {
                return data.access_token; // Success!
            }
            
            // If Zoho says "Access Denied", log it and wait.
            console.warn(`Token Attempt ${i + 1} failed:`, data.error || data);
            
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, delay)); // Wait (1s, 2s...)
                delay *= 2; // Wait longer next time
            } else {
                throw new Error(JSON.stringify(data));
            }
        } catch (err) {
            console.error(`Network error on attempt ${i + 1}:`, err);
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

        // 1. Get Zoho Access Token (WITH RETRY)
        let accessToken;
        try {
            accessToken = await getAccessTokenWithRetry();
        } catch (tokenErr) {
            console.error("FINAL TOKEN FAILURE:", tokenErr);
            return {
                statusCode: 429, 
                headers,
                body: JSON.stringify({ error: "System busy. Please try again in a few seconds." })
            };
        }

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

        // 3. Get Job Details (USING CRITERIA SEARCH)
        // Ensure we get Mover_Count by using criteria search instead of direct ID fetch
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}?criteria=(ID == ${jobId})`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000 || !jobData.data || jobData.data.length === 0) {
            throw new Error("Could not find Job Record");
        }

        // Handle Array Response safely
        const currentRecord = jobData.data[0];
        
        // --- LOGIC CHECKS ---

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

        // Log capacity for debugging
        console.log(`Capacity Check: ${currentCount} / ${targetCount}`);

        if (currentCount >= targetCount) {
            return {
                statusCode: 409, 
                headers,
                body: JSON.stringify({ error: "This job is already full." })
            };
        }

        // 4. Update Job
        existingMovers.push(moverId);

        // For PATCH, we must use the specific ID URL (not criteria)
        const updateUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const updateBody = {
            "data": {
                "Movers2": existingMovers
            }
        };

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