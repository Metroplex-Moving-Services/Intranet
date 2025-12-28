exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    // --- HELPER: RETRY LOGIC ---
    // Tries to get a token up to 3 times if Zoho says "Access Denied"
    async function getAccessTokenWithRetry(retries = 3, delay = 1000) {
        const { ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = process.env;
        const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
        
        for (let i = 0; i < retries; i++) {
            try {
                const res = await fetch(tokenUrl, { method: 'POST' });
                const data = await res.json();
                
                if (data.access_token) return data.access_token; // Success!
                
                // If Rate Limited, wait and retry
                console.warn(`Token Attempt ${i + 1} failed:`, data.error || data);
                if (i < retries - 1) {
                    await new Promise(r => setTimeout(r, delay)); 
                    delay *= 2; // Wait longer next time (1s, 2s, 4s)
                } else {
                    throw new Error(JSON.stringify(data));
                }
            } catch (err) {
                console.error(`Network error on attempt ${i + 1}:`, err);
                if (i === retries - 1) throw err;
            }
        }
    }

    try {
        if (typeof fetch === "undefined") throw new Error("Node version too old.");
        
        const { ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = process.env;
        if (!ZOHO_REFRESH_TOKEN || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
            throw new Error("Missing Zoho Credentials in Netlify.");
        }

        const APP_OWNER = "information152";
        const APP_LINK = "household-goods-moving-services";
        const REPORT_NAME = "Proposal_Contract_Report"; 

        const requestedId = event.queryStringParameters ? event.queryStringParameters.id : null;

        // 1. Get Access Token (WITH RETRY)
        let accessToken;
        try {
            accessToken = await getAccessTokenWithRetry();
        } catch (tokenErr) {
            console.error("FINAL TOKEN FAILURE:", tokenErr);
            return {
                statusCode: 429, 
                headers, 
                body: JSON.stringify({ error: "Zoho is busy. Please try again.", details: tokenErr.message }) 
            };
        }

        // 2. Construct URL
        let dataUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_NAME}`;
        
        if (requestedId) {
            dataUrl += `?criteria=(ID == ${requestedId})`;
        }

        // 3. Fetch Data
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
        console.error("FUNCTION CRASH:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};