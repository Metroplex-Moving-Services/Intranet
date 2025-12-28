/* ============================================================
   netlify/functions/get-calendar.js
   (v2.1 - Debug Mode: Fixes 503 Crashes & CORS)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_NAME = "Proposal_Contract_Report"; 

// CACHE
let cachedAccessToken = null;
let tokenExpiryTime = 0;

async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
        console.log("Using Cached Token");
        return cachedAccessToken;
    }

    console.log("Fetching NEW Token...");
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(tokenUrl, { method: 'POST' });
            const data = await res.json();
            
            if (data.error) throw new Error("Zoho Auth Error: " + JSON.stringify(data));

            if (data.access_token) {
                cachedAccessToken = data.access_token;
                tokenExpiryTime = Date.now() + (data.expires_in * 1000);
                return data.access_token;
            }
            if (i < retries - 1) { await new Promise(r => setTimeout(r, delay)); delay *= 2; }
            else throw new Error(JSON.stringify(data));
        } catch (err) { 
            if (i === retries - 1) throw err; 
        }
    }
}

exports.handler = async function(event, context) {
    // 1. DEFINE HEADERS FIRST (To ensure they always exist)
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        // SAFETY CHECK: Does 'fetch' exist? (Common Node version issue)
        if (typeof fetch === "undefined") {
            throw new Error("Node.js version too old. 'fetch' is undefined. Please set NODE_VERSION to 18 in Netlify.");
        }

        // 2. Logic
        let requestedId = event.queryStringParameters ? event.queryStringParameters.id : null;
        if (requestedId) requestedId = requestedId.replace(/\D/g, ''); 

        const accessToken = await getAccessTokenWithRetry();

        let dataUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_NAME}`;
        if (requestedId) dataUrl += `?criteria=(ID == ${requestedId})`;

        const dataResponse = await fetch(dataUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        // 3. Handle Non-JSON Responses (Zoho sometimes returns HTML on error)
        const text = await dataResponse.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error(`Invalid JSON from Zoho: ${text.substring(0, 100)}...`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(json)
        };

    } catch (error) {
        console.error("Calendar Crash:", error);
        
        // 4. RATE LIMIT HANDLING
        const errStr = error.message || "";
        if (errStr.includes("Zoho is busy") || errStr.includes("429")) {
            return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ error: "System is busy. Please try again in 1 minute." })
            };
        }

        // Return 500 but WITH headers so CORS doesn't mask the error
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ error: `Server Error: ${error.message}` }) 
        };
    }
};