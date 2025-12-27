const fetch = require('node-fetch');

// --- ZOHO CONFIGURATION ---
// Ensure these match your existing get-calendar config in Netlify Environment Variables
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

// Update these if your App Owner / Link Names differ
const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";         // To find Mover ID
const REPORT_JOBS = "Current_Bookings";     // To get current team
const FORM_UPDATE = "Proposal_Contract";    // To update the record

exports.handler = async function(event, context) {
    // 1. Handle CORS (Allow browser requests)
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
            throw new Error("Could not generate Zoho Access Token");
        }
        const accessToken = tokenData.access_token;
        const authHeader = { 'Authorization': `Zoho-oauthtoken ${accessToken}` };

        // 3. STEP A: Find Mover ID by Email
        const findMoverUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${email}")`;
        const moverRes = await fetch(findMoverUrl, { headers: authHeader });
        const moverData = await moverRes.json();

        if (moverData.code === 3000 && moverData.data.length > 0) {
            // Mover Found!
        } else {
            throw new Error(`Mover not found with email: ${email}`);
        }
        
        const moverRecord = moverData.data[0];
        const moverId = moverRecord.ID;

        // 4. STEP B: Get Current Job (to preserve existing team)
        const jobUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_JOBS}/${jobId}`;
        const jobRes = await fetch(jobUrl, { headers: authHeader });
        const jobData = await jobRes.json();

        if (jobData.code !== 3000) {
            throw new Error("Could not find Job Record");
        }

        // Logic to merge Movers2 list
        const currentRecord = jobData.data;
        let existingMovers = [];

        // Zoho returns Multi-Select lookups as an Array of Objects OR Strings depending on version
        if (Array.isArray(currentRecord.Movers2)) {
            // If it's objects, map to ID. If strings, keep as is.
            existingMovers = currentRecord.Movers2.map(m => (typeof m === 'object' ? m.ID : m));
        } else if (typeof currentRecord.Movers2 === 'string' && currentRecord.Movers2.trim() !== "") {
             // Sometimes returns comma separated string
             existingMovers = currentRecord.Movers2.split(',');
        }

        // Check if already added
        if (existingMovers.includes(moverId)) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ message: "Mover already assigned" })
            };
        }

        // Add new ID
        existingMovers.push(moverId);

        // 5. STEP C: Update Job Record
        const updateUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/form/${FORM_UPDATE}/${jobId}`;
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
            throw new Error(`Zoho Update Failed: ${JSON.stringify(updateData)}`);
        }

    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};