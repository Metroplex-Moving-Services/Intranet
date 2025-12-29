/* ============================================================
   netlify/functions/get-calendar.js
   (v2.3 - Bulletproof Mode: Universal Timeout & Crash Protection)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_NAME = "Proposal_Contract_Report"; 

// --- CACHE ---
let cachedAccessToken = null;
let tokenExpiryTime = 0;

// --- HELPER: UNIVERSAL TIMEOUT ---
// Forces a failure if Zoho takes > 5 seconds, preventing Netlify 503s
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Zoho Request Timed Out')), timeout)
    );
    return Promise.race([fetch(url, options), timeoutPromise]);
}

async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) {
        console.log("Using Cached Token");
        return cachedAccessToken;
    }

    console.log("Fetching NEW Token...");
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetchWithTimeout(tokenUrl, { method: 'POST' });
            const data = await res.json();
            
            if (data.error) throw new Error("Zoho Auth Error: " + JSON.stringify(data));

            if (data.access_token) {
                cachedAccessToken = data.access_token;
                tokenExpiryTime = Date.now() + (data.expires_in * 1000);
                return data.access_token;
            }
            throw new Error(JSON.stringify(data));
        } catch (err) { 
            console.warn(`Attempt ${i+1} failed: ${err.message}`);
            if (i < retries - 1) { await new Promise(r => setTimeout(r, delay)); delay *= 2; }
            else throw err; 
        }
    }
}

exports.handler = async function(event, context) {
    // 1. DEFINE HEADERS IMMEDIATELY
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        // Safety Check: Is fetch available?
        if (typeof fetch === "undefined") {
            throw new Error("Node.js version too old. Please set NODE_VERSION to 20 in Netlify.");
        }

        // 2. Logic
        let requestedId = event.queryStringParameters ? event.queryStringParameters.id : null;
        if (requestedId) requestedId = requestedId.replace(/\D/g, ''); 

        const accessToken = await getAccessTokenWithRetry();

        let dataUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_NAME}`;
        if (requestedId) dataUrl += `?criteria=(ID == ${requestedId})`;

        // 3. Fetch Data
        const dataResponse = await fetchWithTimeout(dataUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

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
        console.error("Function Error:", error);
        
        // 4. GRACEFUL ERROR RETURN (Prevents CORS Errors)
        return {
            statusCode: 500,
            headers, 
            body: JSON.stringify({ 
                error: "Server Error", 
                details: error.message || "Unknown Error"
            }) 
        };
    }
};