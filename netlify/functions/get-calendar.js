/* ============================================================
   netlify/functions/get-calendar.js
   (v2.0 - Production Ready: Adds Token Caching)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_NAME = "Proposal_Contract_Report"; 

// --- GLOBAL CACHE (The Fix for Error 429) ---
// This variable stays alive between requests as long as the server is "warm"
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: GET TOKEN (With Caching) ---
async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    // 1. Check Cache (Reuse token if valid)
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
        console.log("Using Cached Zoho Token for Calendar");
        return cachedAccessToken;
    }

    console.log("Fetching NEW Zoho Token for Calendar...");
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(tokenUrl, { method: 'POST' });
            const data = await res.json();
            
            // Catch Rate Limit Errors specifically
            if (data.error) throw new Error(JSON.stringify(data));

            if (data.access_token) {
                // 2. Save to Cache
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        // 1. Get and Sanitize ID (from your original code)
        let requestedId = event.queryStringParameters ? event.queryStringParameters.id : null;
        if (requestedId) {
            requestedId = requestedId.replace(/\D/g, ''); 
        }

        // 2. Get Access Token (Using the new Caching System)
        const accessToken = await getAccessTokenWithRetry();

        // 3. Construct URL
        let dataUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_NAME}`;
        
        if (requestedId) {
            dataUrl += `?criteria=(ID == ${requestedId})`;
        }

        // 4. Fetch Data
        const dataResponse = await fetch(dataUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        const json = await dataResponse.json();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(json)
        };

    } catch (error) {
        console.error("Calendar Error:", error);
        
        // Handle Rate Limit gracefully
        const errorString = error.message || JSON.stringify(error);
        if (errorString.includes("too many requests") || errorString.includes("429")) {
             return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ error: "System busy. Please refresh in a moment." })
            };
        }

        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};