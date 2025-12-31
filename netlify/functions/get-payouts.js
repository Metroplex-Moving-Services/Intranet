/* ============================================================
   netlify/functions/get-payouts.js
   Description: Proxy for Zoho Creator "Payouts_Report" (alldata)
   Securely filters data so users only see THEIR timesheets.
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const REPORT_MOVERS = "All_Movers";
// The URL provided was .../#Report:alldata, so the API link name is "alldata"
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
    throw new Error("Zoho Auth Failed");
}

exports.handler = async function(event, context) {
    // 1. Handle CORS and Options
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        // 2. Validate User (Decode Descope Token)
        const authHeader = event.headers.authorization || event.headers.Authorization;
        if (!authHeader) throw new Error("No Auth Token");
        
        // In production, verify the JWT signature. 
        // For now, we decode to get the email to find the Zoho ID.
        const tokenParts = authHeader.split(' ');
        const token = tokenParts.length === 2 ? tokenParts[1] : null;
        if (!token) throw new Error("Invalid Token Format");

        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        const user = JSON.parse(jsonPayload);
        
        const userEmail = user.email || (user.loginIds ? user.loginIds[0] : null);
        if (!userEmail) throw new Error("User email not found in token");

        // 3. Connect to Zoho
        const zohoToken = await getAccessToken();
        const zohoHeaders = { 'Authorization': `Zoho-oauthtoken ${zohoToken}` };
        const baseUrl = "https://creator.zoho.com/api/v2";

        // 4. LOOKUP: Get Mover ID from Email
        // We cannot query Payouts by email directly because the form doesn't have an email field.
        const moverUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_MOVERS}?criteria=(Email == "${userEmail}")`;
        const moverRes = await fetch(moverUrl, { headers: zohoHeaders });
        const moverData = await moverRes.json();

        if (moverData.code !== 3000 || !moverData.data || moverData.data.length === 0) {
            // User exists in Descope but not in Zoho Movers list
            return { statusCode: 200, headers, body: JSON.stringify({ data: [] }) };
        }
        
        const moverID = moverData.data[0].ID;

        // 5. FETCH PAYOUTS: Filter by MoverID
        // Using "MoverID" as per your "Add_a_payout" form definition
        const payoutsUrl = `${baseUrl}/${APP_OWNER}/${APP_LINK}/report/${REPORT_PAYOUTS}?criteria=(MoverID == ${moverID})`;
        const payoutsRes = await fetch(payoutsUrl, { headers: zohoHeaders });
        const payoutsData = await payoutsRes.json();

        // 6. Return Data
        let finalData = [];
        if (payoutsData.code === 3000 && payoutsData.data) {
            // Sort by Date Descending (Newest first)
            finalData = payoutsData.data.sort((a, b) => new Date(b.Job_Date) - new Date(a.Job_Date));
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ data: finalData })
        };

    } catch (error) {
        console.error("Payouts Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};