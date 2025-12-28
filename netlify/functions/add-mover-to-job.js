// --- ZOHO CONFIGURATION ---
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";         
const REPORT_JOBS = "Proposal_Contract_Report"; 

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

        // 1. Get Zoho Access Token
        const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
        const tokenRes = await fetch(tokenUrl, { method: 'POST' });
        const tokenData = await tokenRes.json();
        
        if (!tokenData.access_token) {
            console.error("Token Error:", tokenData);
            throw new Error("Could not generate Zoho Access Token");
        }
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${tokenData.access_token}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // 2. Find Mover ID
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${email}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            throw new Error(`Mover not found in Zoho with email: ${email}`);
        }
        const moverId = moverData.data[0].ID;

        // 3. Get Job Details (UPDATED METHOD: Using Criteria instead of direct ID)
        // This ensures we get the exact same fields (like Mover_Count) as the calendar list view.
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}?criteria=(ID == ${jobId})`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000 || !jobData.data || jobData.data.length === 0) {
            throw new Error("Could not find Job Record");
        }

        // Using criteria always returns an array, so we safely grab the first item
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
        // We parse the count. If it's missing/null/undefined, we default to 0.
        const targetCount = parseInt(currentRecord.Mover_Count) || 0;
        const currentCount = existingMovers.length;

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