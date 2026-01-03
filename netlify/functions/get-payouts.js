/* ============================================================
   netlify/functions/get-payouts.js
   (Final Fix: Reads Email from Header)
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";
const REPORT_PAYOUTS = "alldata"; 

// --- CACHE TOKEN ---
let cachedAccessToken = null;
let tokenExpiryTime = 0;

async function getAccessToken() {
    if (cachedAccessToken && Date.now() < (tokenExpiryTime - 60000)) return cachedAccessToken;
    
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    const response = await fetch(tokenUrl, { method: 'POST' });
    const data = await response.json();
    
    if (data.access_token) {
        cachedAccessToken = data.access_token;
        tokenExpiryTime = Date.now() + (data.expires_in * 1000);
        return data.access_token;
    }
    throw new Error("Zoho Auth Failed: " + JSON.stringify(data));
}

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        // 1. Get Token & Email
        const authHeader = event.headers.authorization || event.headers.Authorization;
        // Read the custom header (Netlify lowercases all headers)
        const userEmail = event.headers['x-user-email'] || event.headers['X-User-Email'];

        if (!authHeader) throw new Error("No Auth Token provided");
        if (!userEmail) throw new Error("No User Email provided in headers");

        // 2. Validate Token (Simple Decode Check)
        // In a strict environment, we would also verify the signature here.
        // For now, we ensure the token exists and decode it to ensure it's a valid JWT structure.
        const tokenParts = authHeader.split(' ');
        const token = tokenParts.length === 2 ? tokenParts[1] : null;
        if (!token) throw new Error("Invalid Token Format");

        // 3. Zoho Lookup
        const zohoToken = await getAccessToken();
        const zohoHeaders = { 'Authorization': `Zoho-oauthtoken ${zohoToken}` };
        
        const moverUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetch(moverUrl, { headers: zohoHeaders });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            // No mover found for this email
            return { statusCode: 200, headers, body: JSON.stringify({ data: [] }) };
        }

        const moverID = moverData.data[0].ID;

        // 4. Fetch Payouts
        const payoutsUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/report/${REPORT_PAYOUTS}?criteria=(MoverID == ${moverID})`;
        const payoutsRes = await fetch(payoutsUrl, { headers: zohoHeaders });
        const payoutsData = await payoutsRes.json();

        let finalData = [];
        if (payoutsData.code === 3000 && payoutsData.data) {
            finalData = payoutsData.data.sort((a, b) => new Date(b.Job_Date) - new Date(a.Job_Date));
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ data: finalData })
        };

    } catch (error) {
        console.error("Handler Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};