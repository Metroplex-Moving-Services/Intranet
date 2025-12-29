/* ============================================================
   netlify/functions/get-calendar.js
   (v2.2 - Emergency Fix: Adds 5-Second Timeout to prevent 503 Crashes)
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

// --- HELPER: FETCH WITH TIMEOUT ---
// Prevents Netlify 503 errors by giving up after 5 seconds
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request timed out (Zoho did not respond in 5s)');
        }
        throw error;
    } finally {
        clearTimeout(id);
    }
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
            // Use our new safe fetch
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
        if (typeof fetch === "undefined") {
            throw new Error("Node version too old. Please set NODE_VERSION to 18 in Netlify.");
        }

        // 2. Logic
        let requestedId = event.queryStringParameters ? event.queryStringParameters.id : null;
        if (requestedId) requestedId = requestedId.replace(/\D/g, ''); 

        const accessToken = await getAccessTokenWithRetry();

        let dataUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_NAME}`;
        if (requestedId) dataUrl += `?criteria=(ID == ${requestedId})`;

        // 3. Fetch Data (Safely)
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
        console.error("Calendar Crash:", error);
        
        // 4. GRACEFUL ERROR HANDLING
        // Even if we timeout, we send JSON + Headers so the browser doesn't block it with CORS
        return {
            statusCode: 500, // or 408 for timeout
            headers, 
            body: JSON.stringify({ 
                error: "System Error", 
                details: error.message || "Connection timed out."
            }) 
        };
    }
};