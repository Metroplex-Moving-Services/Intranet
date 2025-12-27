exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // 1. Check if fetch exists (Node 18+ check)
        if (typeof fetch === "undefined") {
            console.error("CRITICAL: 'fetch' is not defined. You are likely on Node 14/16.");
            throw new Error("Server configuration error: Node version too old.");
        }

        // 2. Validate Environment Variables
        const { ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = process.env;
        
        if (!ZOHO_REFRESH_TOKEN || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
            console.error("Missing Env Vars:", { 
                hasToken: !!ZOHO_REFRESH_TOKEN, 
                hasID: !!ZOHO_CLIENT_ID, 
                hasSecret: !!ZOHO_CLIENT_SECRET 
            });
            throw new Error("Missing Zoho Credentials in Netlify.");
        }

        const APP_OWNER = "information152";
        const APP_LINK = "household-goods-moving-services";
        const REPORT_NAME = "Proposal_Contract_Report"; 

        // 3. Get Access Token
        const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
        
        const tokenResponse = await fetch(tokenUrl, { method: 'POST' });
        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            console.error("Zoho Token Refusal:", JSON.stringify(tokenData));
            return { 
                statusCode: 500, 
                headers, 
                body: JSON.stringify({ error: "Zoho rejected the login.", details: tokenData }) 
            };
        }

        const accessToken = tokenData.access_token;

        // 4. Fetch Calendar Data
        const dataUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_NAME}`;
        const dataResponse = await fetch(dataUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        const json = await dataResponse.json();

        // 5. Success
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(json)
        };

    } catch (error) {
        console.error("FUNCTION CRASH:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};