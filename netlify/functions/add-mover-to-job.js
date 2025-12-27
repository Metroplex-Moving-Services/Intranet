const fetch = require('node-fetch'); // Remove this line if using Node 18+ in Netlify

// --- ZOHO CONFIGURATION ---
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";         // To find Mover ID
const REPORT_JOBS = "Current_Bookings";     // To get AND update the job record

exports.handler = async function(event, context) {
    // 1. CORS Headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        const { jobId, email } = payload;

        if (!jobId || !email) {
            throw new Error("Missing jobId or email");
        }

        // 2. Get Zoho Access Token
        const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
        const tokenRes = await fetch(tokenUrl, { method: 'POST' });
        const tokenData = await tokenRes.json();
        
        if (!tokenData.access_token) {
            console.error("Token Error:", tokenData);
            throw new Error("Could not generate Zoho Access Token");
        }
        const accessToken = tokenData.access_token;
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };

        // 3. STEP A: Find Mover ID by Email
        // Note: Using creatorapp.zoho.com or creator.zoho.com depending on your account. 
        // Standard API is creator.zoho.com. If this fails with 1000 again, try creatorapp.zoho.com
        const baseUrl = "https://creator.zoho.com/api/v2";
        
        const findMoverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${email}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            console.error("Mover Search Failed:", moverData);
            throw new Error(`Mover not found in Zoho with email: ${email}`);
        }
        
        const moverRecord = moverData.data[0];
        const moverId = moverRecord.ID;

        // 4. STEP B: Get Current Job (to preserve existing team)
        const jobUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000) {
            console.error("Job Search Failed:", jobData);
            throw new Error("Could not find Job Record in 'Current_Bookings'");
        }

        // Logic to merge Movers2 list
        const currentRecord = jobData.data;
        let existingMovers = [];

        // Handle different Zoho response formats (Array of objects vs String)
        if (Array.isArray(currentRecord.Movers2)) {
            existingMovers = currentRecord.Movers2.map(m => (typeof m === 'object' ? m.ID : m));
        } else if (typeof currentRecord.Movers2 === 'string' && currentRecord.Movers2.trim() !== "") {
             existingMovers = currentRecord.Movers2.split(',');
        }

        // Check if already added to prevent duplicates
        if (existingMovers.includes(moverId)) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ message: "Mover already assigned", success: true })
            };
        }

        // Add new ID
        existingMovers.push(moverId);

        // 5. STEP C: Update Job Record
        // FIX: We must update via the REPORT URL (REPORT_JOBS), not the Form URL
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